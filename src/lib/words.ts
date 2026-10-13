/**
 * Data access for the puzzle.
 *
 * Every read and write goes through this module so the rest of the app never
 * touches Mongoose directly. Records are mapped to serialisable *views* here,
 * because server functions can only return plain JSON.
 *
 * The two rules that shape most of this file:
 *
 * - **One word per day, forever.** A day is identified by its Sudan calendar
 *   date, and a unique index guarantees a single record per day.
 * - **Automatic picks never repeat.** A word is only auto-picked while it has
 *   never been served and is not already bound to a day. The operator can
 *   always override explicitly, and a deliberate repeat is allowed.
 */

import { randomBytes } from "node:crypto";

import type mongoose from "mongoose";

import { isPlayableWord, normalizeArabic, toLetters } from "./arabic.ts";
import { WORD_LETTER_COUNT } from "./config.ts";
import { ensureSchema } from "./db.ts";
import {
  Day,
  SETTINGS_KEY,
  Settings,
  Word,
  type DayRevision,
  type DaySource,
} from "./jradil-model.ts";
import { sudanDateKey, type DateKey } from "./sudan-time.ts";
import { normalizeExternalLink } from "./url.ts";

// ---------------------------------------------------------------- views --

export type WordView = {
  id: string;
  text: string;
  letterCount: number;
  dialect: boolean;
  pool: boolean;
  notes: string | null;
  /** Optional page about the word, shown to the player after the puzzle ends. */
  link: string | null;
  assignedDateKey: string | null;
  firstServedDateKey: string | null;
  lastServedDateKey: string | null;
  timesServed: number;
  createdAt: string;
};

export type DayView = {
  dateKey: string;
  wordText: string;
  source: DaySource;
  updatedAt: string;
  revisions: { wordText: string; source: DaySource; at: string }[];
};

export type DayResolution =
  /** A word is bound to the day; the game can be played. */
  | { status: "ready"; day: DayView }
  /** A future day with nothing scheduled yet. */
  | { status: "pending"; dateKey: DateKey }
  /** Today, but the candidate pool had nothing left to pick from. */
  | { status: "no-candidates"; dateKey: DateKey }
  /** A past day that was never played, so no word was ever consumed. */
  | { status: "unresolved"; dateKey: DateKey };

export type SettingsView = {
  poolSize: number;
  enforceDictionary: boolean;
};

export type PoolStatus = {
  /** The operator's target size for the candidate pool. */
  target: number;
  /** Words currently flagged into the pool. */
  flagged: number;
  /** Of those, the ones still available for an automatic pick. */
  available: number;
  /** Of those, the ones already bound to a day. */
  spent: number;
  /** Unused dialect words that could be added to the pool. */
  addable: number;
};

export type DashboardStats = {
  dictionaryTotal: number;
  dialectTotal: number;
  /** Dialect words never served and not reserved — the long-run supply. */
  dialectAvailable: number;
  usedTotal: number;
  daysRecorded: number;
  lastResolvedDateKey: DateKey | null;
  nextScheduledDateKey: DateKey | null;
  pool: PoolStatus;
};

// -------------------------------------------------------------- mapping --

type WordLike = {
  _id: mongoose.Types.ObjectId;
  text: string;
  letterCount: number;
  dialect: boolean;
  pool: boolean;
  notes?: string | null;
  link?: string | null;
  assignedDateKey?: string | null;
  firstServedDateKey?: string | null;
  lastServedDateKey?: string | null;
  timesServed?: number;
  createdAt?: Date;
};

type DayLike = {
  dateKey: string;
  wordText: string;
  source: DaySource;
  revisions?: DayRevision[];
  updatedAt?: Date;
};

/**
 * Mongoose's lean/discriminator types describe these documents with mapped
 * generics that are structurally compatible but not identical. The shape is
 * guaranteed by the schema, so the narrowing happens once, here.
 */
function asWordLike(value: unknown): WordLike {
  return value as WordLike;
}

function asDayLike(value: unknown): DayLike {
  return value as DayLike;
}

export function toWordView(word: WordLike): WordView {
  return {
    id: String(word._id),
    text: word.text,
    letterCount: word.letterCount,
    dialect: word.dialect,
    pool: word.pool,
    notes: word.notes ?? null,
    link: word.link ?? null,
    assignedDateKey: word.assignedDateKey ?? null,
    firstServedDateKey: word.firstServedDateKey ?? null,
    lastServedDateKey: word.lastServedDateKey ?? null,
    timesServed: word.timesServed ?? 0,
    createdAt: (word.createdAt ?? new Date()).toISOString(),
  };
}

export function toDayView(day: DayLike): DayView {
  return {
    dateKey: day.dateKey,
    wordText: day.wordText,
    source: day.source,
    updatedAt: (day.updatedAt ?? new Date()).toISOString(),
    revisions: (day.revisions ?? []).map((revision) => ({
      wordText: revision.wordText,
      source: revision.source,
      at: revision.at.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------- cache --

/**
 * How long the two reads every guess needs — the settings and the day's word —
 * are reused before going back to the database. Writes made through this module
 * drop the cached copy at once; another server instance picks a change up
 * within this window.
 */
const CACHE_TTL_MS = 15_000;

let settingsCache: { value: SettingsView; expiresAt: number } | null = null;
let dayCache: { dateKey: DateKey; day: DayView; expiresAt: number } | null = null;

// ------------------------------------------------------------- settings --

/** Reads the singleton settings document, creating it on first use. */
export async function getSettings(): Promise<SettingsView> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value;
  const value = await readSettings();
  settingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

async function readSettings(): Promise<SettingsView> {
  await ensureSchema();

  const existing = await Settings.findOne({ key: SETTINGS_KEY }).lean();
  if (existing) {
    return { poolSize: existing.poolSize, enforceDictionary: existing.enforceDictionary };
  }

  try {
    const created = await Settings.create({ key: SETTINGS_KEY });
    return { poolSize: created.poolSize, enforceDictionary: created.enforceDictionary };
  } catch (error) {
    // A concurrent request created it first.
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await Settings.findOne({ key: SETTINGS_KEY }).lean();
    return { poolSize: raced?.poolSize ?? 30, enforceDictionary: raced?.enforceDictionary ?? true };
  }
}

export async function updateSettings(patch: Partial<SettingsView>): Promise<SettingsView> {
  await ensureSchema();
  const update: Record<string, unknown> = {};
  if (typeof patch.poolSize === "number") update.poolSize = Math.max(1, Math.floor(patch.poolSize));
  if (typeof patch.enforceDictionary === "boolean") {
    update.enforceDictionary = patch.enforceDictionary;
  }
  if (Object.keys(update).length > 0) {
    await Settings.updateOne({ key: SETTINGS_KEY }, { $set: update }, { upsert: true });
    settingsCache = null;
  }
  return getSettings();
}

let gameSecret: Promise<string> | null = null;

/**
 * The key that signs players' progress tokens.
 *
 * Kept in the settings document rather than the environment so every instance
 * shares it and a deployment needs no extra configuration. The first caller
 * generates it; the conditional write means a concurrent caller can never
 * replace it, and both then read back the one that won.
 */
export function getGameSecret(): Promise<string> {
  gameSecret ??= (async () => {
    await getSettings();
    await Settings.updateOne(
      { key: SETTINGS_KEY, secret: null },
      { $set: { secret: randomBytes(32).toString("base64url") } },
    );
    const settings = await Settings.findOne({ key: SETTINGS_KEY }, { secret: 1 }).lean();
    if (!settings?.secret) throw new Error("تعذّر إنشاء مفتاح التوقيع");
    return settings.secret;
  })().catch((error: unknown) => {
    gameSecret = null;
    throw error;
  });
  return gameSecret;
}

// ---------------------------------------------------------------- words --

export type WordInput = {
  text: string;
  dialect?: boolean;
  pool?: boolean;
  notes?: string | null;
  link?: string | null;
};

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MutationFailure; reason: string };

/** Machine-readable failure codes, so callers can react without matching Arabic text. */
export type MutationFailure =
  | "bad-length"
  | "bad-date"
  | "not-in-dictionary"
  | "not-dialect"
  | "already-used"
  | "reserved"
  | "duplicate"
  | "not-found"
  | "save-failed";

function fail(code: MutationFailure, reason: string): MutationResult<never> {
  return { ok: false, code, reason };
}

function validateWordInput(input: WordInput): MutationResult<{
  text: string;
  normalized: string;
  dialect: boolean;
  pool: boolean;
}> {
  const text = input.text.trim();
  if (!isPlayableWord(text)) {
    return fail("bad-length", `يجب أن تتكوّن الكلمة من ${WORD_LETTER_COUNT} حروف عربية بالضبط`);
  }
  const dialect = input.dialect ?? false;
  // A word can only be a pool candidate if it is already a dialect word.
  const pool = (input.pool ?? false) && dialect;
  return { ok: true, value: { text, normalized: normalizeArabic(text), dialect, pool } };
}

export async function createWord(input: WordInput): Promise<MutationResult<WordView>> {
  await ensureSchema();
  const validated = validateWordInput(input);
  if (!validated.ok) return validated;

  const existing = await Word.findOne({ normalized: validated.value.normalized }).lean();
  if (existing) return fail("duplicate", "الكلمة موجودة في القاموس مسبقًا");

  const created = await Word.create({
    ...validated.value,
    letterCount: toLetters(validated.value.text).length,
    notes: input.notes ?? null,
    link: normalizeExternalLink(input.link),
  });
  return { ok: true, value: toWordView(asWordLike(created.toObject())) };
}

export type WordQuery = {
  search?: string;
  dialect?: boolean;
  pool?: boolean;
  served?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listWords(
  query: WordQuery,
): Promise<{ items: WordView[]; total: number; page: number; pageSize: number }> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 50)));

  const filter: Record<string, unknown> = {};
  if (query.dialect !== undefined) filter.dialect = query.dialect;
  if (query.pool !== undefined) filter.pool = query.pool;
  if (query.served === true) filter.firstServedDateKey = { $ne: null };
  if (query.served === false) filter.firstServedDateKey = null;

  const search = query.search?.trim();
  if (search) {
    // Fold the search term so `اسعار` also finds a stored `أسعار`.
    const folded = normalizeArabic(search);
    filter.normalized = { $regex: escapeRegex(folded), $options: "u" };
  }

  const [documents, total] = await Promise.all([
    Word.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Word.countDocuments(filter),
  ]);

  return {
    items: documents.map((document) => toWordView(asWordLike(document))),
    total,
    page,
    pageSize,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getWordByText(text: string): Promise<WordView | null> {
  await ensureSchema();
  const document = await Word.findOne({ normalized: normalizeArabic(text) }).lean();
  return document ? toWordView(asWordLike(document)) : null;
}

/** True when the folded spelling is present in the dictionary. */
export async function wordExists(text: string): Promise<boolean> {
  await ensureSchema();
  const count = await Word.countDocuments({ normalized: normalizeArabic(text) });
  return count > 0;
}

export type WordPatch = {
  dialect?: boolean;
  pool?: boolean;
  notes?: string | null;
  link?: string | null;
};

export async function updateWord(id: string, patch: WordPatch): Promise<MutationResult<WordView>> {
  await ensureSchema();
  const update: Record<string, unknown> = {};

  if (patch.notes !== undefined) {
    const notes = patch.notes?.trim();
    update.notes = notes ? notes : null;
  }
  if (patch.link !== undefined) {
    // An empty string clears the link; anything unsafe is stored as null.
    update.link = normalizeExternalLink(patch.link);
  }

  if (typeof patch.dialect === "boolean") {
    update.dialect = patch.dialect;
    // Dropping the dialect flag also drops it from the candidate pool.
    if (!patch.dialect) update.pool = false;
  }
  if (typeof patch.pool === "boolean") {
    update.pool = patch.pool;
    if (patch.pool) update.dialect = true;
  }

  const document = await Word.findByIdAndUpdate(
    id,
    { $set: update },
    { returnDocument: "after" },
  ).lean();
  if (!document) return fail("not-found", "الكلمة غير موجودة");
  return { ok: true, value: toWordView(asWordLike(document)) };
}

export async function deleteWord(id: string): Promise<MutationResult<{ id: string }>> {
  await ensureSchema();
  const deleted = await Word.findByIdAndDelete(id).lean();
  if (!deleted) return fail("not-found", "الكلمة غير موجودة");
  // The day record keeps its own copy of the text, so history stays intact.
  return { ok: true, value: { id } };
}

/**
 * Applies dialect/pool flags to a whole selection of words.
 *
 * Unmarking a word as Sudanese also drops it from the pool, because the pool is
 * defined as a subset of dialect words.
 */
export async function bulkUpdateWords(
  ids: readonly string[],
  patch: { dialect?: boolean; pool?: boolean },
): Promise<{ modified: number }> {
  await ensureSchema();
  if (ids.length === 0) return { modified: 0 };

  const update: Record<string, unknown> = {};
  if (patch.dialect !== undefined) {
    update.dialect = patch.dialect;
    if (!patch.dialect) update.pool = false;
  }
  if (patch.pool !== undefined) {
    update.pool = patch.pool;
    // Joining the pool implies the dialect flag.
    if (patch.pool) update.dialect = true;
  }
  if (Object.keys(update).length === 0) return { modified: 0 };

  const result = await Word.updateMany({ _id: { $in: ids } }, { $set: update });
  return { modified: result.modifiedCount };
}

/**
 * Fills the pool up to `target` with randomly chosen dialect words that have
 * never been served and are not already bound to a day.
 */
export async function topUpPool(target: number): Promise<{ added: number; pool: PoolStatus }> {
  await ensureSchema();
  const status = await poolStatus();
  const missing = Math.max(0, Math.floor(target) - status.flagged);
  if (missing === 0) return { added: 0, pool: status };

  const candidates = await Word.aggregate<{ _id: mongoose.Types.ObjectId }>([
    {
      $match: {
        kind: "word",
        dialect: true,
        pool: false,
        assignedDateKey: null,
        firstServedDateKey: null,
      },
    },
    { $sample: { size: missing } },
    { $project: { _id: 1 } },
  ]);

  if (candidates.length === 0) return { added: 0, pool: status };

  await Word.updateMany(
    { _id: { $in: candidates.map((candidate) => candidate._id) } },
    { $set: { pool: true } },
  );

  return { added: candidates.length, pool: await poolStatus() };
}

export async function poolStatus(): Promise<PoolStatus> {
  await ensureSchema();
  const [{ poolSize }, flagged, available, addable] = await Promise.all([
    getSettings(),
    Word.countDocuments({ pool: true }),
    Word.countDocuments({ pool: true, assignedDateKey: null, firstServedDateKey: null }),
    Word.countDocuments({
      dialect: true,
      pool: false,
      assignedDateKey: null,
      firstServedDateKey: null,
    }),
  ]);

  return { target: poolSize, flagged, available, spent: flagged - available, addable };
}

// -------------------------------------------------------------- serving --

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Claims one random available candidate for the day.
 *
 * The find-and-modify is conditional on the word still being free, so two
 * simultaneous requests can never claim the same word. It retries with a fresh
 * random pick if it loses that race.
 */
async function claimRandomPoolWord(dateKey: DateKey) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [sampled] = await Word.aggregate<{ _id: mongoose.Types.ObjectId }>([
      {
        $match: {
          kind: "word",
          dialect: true,
          pool: true,
          assignedDateKey: null,
          firstServedDateKey: null,
        },
      },
      { $sample: { size: 1 } },
      { $project: { _id: 1 } },
    ]);
    if (!sampled) return null;

    const claimed = await Word.findOneAndUpdate(
      { _id: sampled._id, assignedDateKey: null, firstServedDateKey: null },
      { $set: { assignedDateKey: dateKey } },
      { returnDocument: "after", lean: true },
    );
    if (claimed) return claimed;
  }
  return null;
}

/** Records that a word was actually shown to players on a given day. */
async function markServed(id: mongoose.Types.ObjectId, dateKey: DateKey): Promise<void> {
  await Word.updateOne(
    { _id: id, firstServedDateKey: null },
    { $set: { firstServedDateKey: dateKey } },
  );
  await Word.updateOne(
    { _id: id },
    {
      $set: { assignedDateKey: dateKey, lastServedDateKey: dateKey },
      $inc: { timesServed: 1 },
    },
  );
}

/** Frees a word that is no longer bound to a day, unless it was already served. */
async function releaseWord(id: mongoose.Types.ObjectId, dateKey: DateKey): Promise<void> {
  await Word.updateOne({ _id: id, assignedDateKey: dateKey }, { $set: { assignedDateKey: null } });
}

/**
 * Returns the word served on a Sudan day, creating the record if the day has
 * already begun and nothing was scheduled.
 *
 * This is where the automatic fallback lives. The operator's job is to pick a
 * word before midnight; if they have not, the first request after midnight
 * selects a random candidate from the pool and fixes it for the rest of the
 * day. Because the day record is unique, everyone sees the same word.
 *
 * Past days are deliberately *not* back-filled: a day nobody played should not
 * silently consume a candidate.
 */
export async function resolveDay(dateKey: DateKey): Promise<DayResolution> {
  if (dayCache?.dateKey === dateKey && dayCache.expiresAt > Date.now()) {
    return { status: "ready", day: dayCache.day };
  }
  const resolution = await resolveDayUncached(dateKey);
  if (resolution.status === "ready") {
    dayCache = { dateKey, day: resolution.day, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return resolution;
}

async function resolveDayUncached(dateKey: DateKey): Promise<DayResolution> {
  await ensureSchema();

  const existing = await Day.findOne({ dateKey }).lean();
  if (existing) return { status: "ready", day: toDayView(asDayLike(existing)) };

  const today = sudanDateKey();
  if (dateKey > today) return { status: "pending", dateKey };
  if (dateKey < today) return { status: "unresolved", dateKey };

  const claimed = await claimRandomPoolWord(dateKey);
  if (!claimed) return { status: "no-candidates", dateKey };

  try {
    const created = await Day.create({
      dateKey,
      wordId: claimed._id,
      wordText: claimed.text,
      wordNormalized: claimed.normalized,
      source: "auto",
      revisions: [{ wordText: claimed.text, source: "auto", at: new Date() }],
    });
    await markServed(claimed._id, dateKey);
    return { status: "ready", day: toDayView(asDayLike(created.toObject())) };
  } catch (error) {
    // Another request created the day first: give our claim back and use theirs.
    await releaseWord(claimed._id, dateKey);
    if (isDuplicateKeyError(error)) {
      const raced = await Day.findOne({ dateKey }).lean();
      if (raced) return { status: "ready", day: toDayView(asDayLike(raced)) };
    }
    throw error;
  }
}

export type UsedWord = {
  wordText: string;
  firstDateKey: DateKey;
  lastDateKey: DateKey;
  /** How many days this word was served on. */
  times: number;
  /** "mixed" when it was pinned one time and picked automatically another. */
  source: DaySource | "mixed";
};

export type UsedWordsPage = {
  items: UsedWord[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Every word that has ever been a word of the day, most recently served first.
 *
 * Built from the day records rather than from the words, so a word served twice
 * reports both occurrences and the real span. This is the list the operator
 * checks before pinning a word by hand — automatic picks can never repeat, but
 * a manual choice can.
 */
export async function listUsedWords(
  query: { page?: number; pageSize?: number } = {},
): Promise<UsedWordsPage> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));

  const [faceted] = await Day.aggregate<{
    items: {
      _id: string;
      wordText: string;
      firstDateKey: DateKey;
      lastDateKey: DateKey;
      times: number;
      sources: DaySource[];
    }[];
    total: { n: number }[];
  }>([
    { $match: { kind: "day" } },
    // Grouped after sorting so `$last` reports the most recent spelling.
    { $sort: { dateKey: 1 } },
    {
      $group: {
        _id: "$wordNormalized",
        wordText: { $last: "$wordText" },
        firstDateKey: { $min: "$dateKey" },
        lastDateKey: { $max: "$dateKey" },
        times: { $sum: 1 },
        sources: { $addToSet: "$source" },
      },
    },
    { $sort: { lastDateKey: -1, _id: 1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        total: [{ $count: "n" }],
      },
    },
  ]);

  return {
    items: (faceted?.items ?? []).map((row) => ({
      wordText: row.wordText,
      firstDateKey: row.firstDateKey,
      lastDateKey: row.lastDateKey,
      times: row.times,
      source: row.sources.length === 1 ? row.sources[0] : "mixed",
    })),
    total: faceted?.total?.[0]?.n ?? 0,
    page,
    pageSize,
  };
}

/** Reads a day without ever creating one. */
export async function getDay(dateKey: DateKey): Promise<DayView | null> {
  await ensureSchema();
  const document = await Day.findOne({ dateKey }).lean();
  return document ? toDayView(asDayLike(document)) : null;
}

export type SetDayWordOptions = {
  /** Allow a word that is not flagged as Sudanese dialect. */
  allowNonDialect?: boolean;
  /** Add the word to the dictionary if it is not there yet. */
  createIfMissing?: boolean;
  /**
   * Confirm serving a word that already had its own day.
   *
   * Only the automatic pick is barred from repeating; the operator may repeat on
   * purpose, but only after being told. Without this, a repeat is refused so the
   * warning cannot be skipped by accident.
   */
  allowRepeat?: boolean;
};

/**
 * The operator's explicit choice for a day.
 *
 * Unlike the automatic path this may repeat a word, because the operator is
 * assumed to know what they want. The previous word is released only if it was
 * never actually served, so an automatic pick that already happened cannot be
 * pushed back into the pool.
 */
export async function setDayWord(
  dateKey: DateKey,
  text: string,
  options: SetDayWordOptions = {},
): Promise<MutationResult<DayView>> {
  await ensureSchema();

  if (!isPlayableWord(text)) {
    return fail("bad-length", `يجب أن تتكوّن الكلمة من ${WORD_LETTER_COUNT} حروف عربية بالضبط`);
  }

  const normalized = normalizeArabic(text);
  let word = await Word.findOne({ normalized }).lean();

  if (!word) {
    if (!options.createIfMissing) {
      return fail("not-in-dictionary", "الكلمة غير موجودة في القاموس");
    }
    const created = await Word.create({
      text: text.trim(),
      normalized,
      letterCount: toLetters(text).length,
      dialect: true,
      pool: false,
      notes: "أُضيفت من اختيار كلمة اليوم",
    });
    word = created.toObject();
  }

  if (!word.dialect && !options.allowNonDialect) {
    return fail("not-dialect", "الكلمة ليست معلَّمة ككلمة سودانية");
  }

  const today = sudanDateKey();

  // Every refusal happens before the first write, so a rejected choice leaves
  // the current day exactly as it was.
  if (
    word.lastServedDateKey !== null &&
    word.lastServedDateKey !== dateKey &&
    !options.allowRepeat
  ) {
    const times = word.timesServed ?? 1;
    return fail(
      "already-used",
      times > 1
        ? `«${word.text}» سبق أن كانت كلمة اليوم ${times} مرات، آخرها ${word.lastServedDateKey}.`
        : `«${word.text}» سبق أن كانت كلمة اليوم بتاريخ ${word.firstServedDateKey}.`,
    );
  }

  // Refuse to book the same word onto two *future* days by accident.
  //
  // A word served today also carries today as its `assignedDateKey`, which is a
  // statement about where it has been, not a booking for later — so only a
  // strictly future binding counts as reserved. Overlapping that with "already
  // used" would report the wrong reason.
  if (word.assignedDateKey && word.assignedDateKey !== dateKey && word.assignedDateKey > today) {
    return fail("reserved", `الكلمة محجوزة ليوم ${word.assignedDateKey}. ألغِ ذلك اليوم أولًا.`);
  }

  const previous = await Day.findOne({ dateKey }).lean();
  if (previous?.wordId && String(previous.wordId) !== String(word._id)) {
    await releaseWord(previous.wordId, dateKey);
  }

  await Word.updateOne({ _id: word._id }, { $set: { assignedDateKey: dateKey } });

  // Future days are only reserved; the word counts as served once its day starts.
  if (dateKey <= today) {
    if (word.firstServedDateKey === null) {
      await markServed(word._id, dateKey);
    } else {
      await Word.updateOne(
        { _id: word._id },
        { $set: { lastServedDateKey: dateKey }, $inc: { timesServed: 1 } },
      );
    }
  }

  const day = await Day.findOneAndUpdate(
    { dateKey },
    {
      $set: {
        wordId: word._id,
        wordText: word.text,
        wordNormalized: normalized,
        source: "admin",
      },
      $push: {
        revisions: { wordText: word.text, source: "admin", at: new Date() },
      },
    },
    { upsert: true, returnDocument: "after", lean: true },
  );
  dayCache = null;

  if (!day) return fail("save-failed", "تعذّر حفظ كلمة اليوم");
  return { ok: true, value: toDayView(asDayLike(day)) };
}

/** Removes a day's assignment. A future day returns to the automatic path. */
export async function clearDayWord(
  dateKey: DateKey,
): Promise<MutationResult<{ dateKey: DateKey }>> {
  await ensureSchema();
  const day = await Day.findOne({ dateKey }).lean();
  if (!day) return fail("not-found", "لا يوجد سجل لهذا اليوم");

  if (day.wordId) await releaseWord(day.wordId, dateKey);
  await Day.deleteOne({ dateKey });
  dayCache = null;
  return { ok: true, value: { dateKey } };
}

export type DayQuery = { from?: DateKey; to?: DateKey; page?: number; pageSize?: number };

export async function listDays(
  query: DayQuery = {},
): Promise<{ items: DayView[]; total: number; page: number; pageSize: number }> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 30)));

  const filter: Record<string, unknown> = {};
  if (query.from || query.to) {
    const range: Record<string, string> = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    filter.dateKey = range;
  }

  const [documents, total] = await Promise.all([
    Day.find(filter)
      .sort({ dateKey: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Day.countDocuments(filter),
  ]);

  return {
    items: documents.map((document) => toDayView(asDayLike(document))),
    total,
    page,
    pageSize,
  };
}

export async function getStats(): Promise<DashboardStats> {
  await ensureSchema();
  const today = sudanDateKey();

  const [
    dictionaryTotal,
    dialectTotal,
    dialectAvailable,
    usedTotal,
    daysRecorded,
    lastDay,
    nextDay,
    pool,
  ] = await Promise.all([
    Word.countDocuments({}),
    Word.countDocuments({ dialect: true }),
    Word.countDocuments({ dialect: true, assignedDateKey: null, firstServedDateKey: null }),
    Word.countDocuments({ firstServedDateKey: { $ne: null } }),
    Day.countDocuments({}),
    Day.findOne({ dateKey: { $lte: today } })
      .sort({ dateKey: -1 })
      .lean(),
    Day.findOne({ dateKey: { $gt: today } })
      .sort({ dateKey: 1 })
      .lean(),
    poolStatus(),
  ]);

  return {
    dictionaryTotal,
    dialectTotal,
    dialectAvailable,
    usedTotal,
    daysRecorded,
    lastResolvedDateKey: lastDay ? asDayLike(lastDay).dateKey : null,
    nextScheduledDateKey: nextDay ? asDayLike(nextDay).dateKey : null,
    pool,
  };
}
