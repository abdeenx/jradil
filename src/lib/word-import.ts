/**
 * Bulk word import.
 *
 * Two entry points use this: the "import" panel in the operator dashboard, and
 * the `db:import` script for large files that are easier to hand to a shell.
 *
 * Accepted inputs, auto-detected:
 *
 * - JSON array of strings — `["مدرسة", "جامعة"]`
 * - JSON array of objects — `[{ "text": "مدرسة", "dialect": true }]`
 * - JSON object with a `words` array, or newline-delimited JSON objects
 * - CSV / TSV, with or without a header row
 * - one word per line
 *
 * A `dialect`/`pool` flag is optional. When it is absent the existing value is
 * left alone on re-import, so importing a plain word list never undoes the
 * operator's marking work.
 */

import { isBaseLetter, normalizeArabic, toLetters } from "./arabic.ts";
import { WORD_LETTER_COUNT } from "./config.ts";
import { ensureSchema } from "./db.ts";
import { Word } from "./jradil-model.ts";
import { normalizeExternalLink } from "./url.ts";

export const MAX_IMPORT_ROWS = 50_000;

/**
 * Flags applied to every row that does not state its own.
 *
 * This is what makes phased loading work: first import the general Arabic
 * dictionary with `dialect: false`, then import the Sudanese list with
 * `dialect: true` — or `dialect: true, pool: true` to also shortlist it.
 * A row that states its own flags still wins.
 */
export type ImportDefaults = { dialect?: boolean; pool?: boolean };

/** Shape handed to `bulkWrite`, kept explicit so the cast at the call site is honest. */
type BulkOperation = {
  updateOne: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
    upsert: boolean;
  };
};

export type ParsedWord = {
  text: string;
  dialect?: boolean;
  pool?: boolean;
  notes?: string | null;
  /** Optional page about the word, shown to the player after the puzzle ends. */
  link?: string | null;
};

export type ImportSummary = {
  /** Rows found in the payload after parsing. */
  received: number;
  /** Documents created. */
  inserted: number;
  /**
   * Documents that were already in the dictionary and were written again.
   *
   * The count is not split into "changed" and "unchanged": Mongoose refreshes
   * `updatedAt` on every matched write, so the two are indistinguishable here.
   */
  matched: number;
  /** Rows rejected, with the reason. */
  skipped: { text: string; reason: string }[];
  /** True when the payload exceeded {@link MAX_IMPORT_ROWS}. */
  truncated: boolean;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "y", "t", "نعم", "صح", "صحيح", "ن"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "f", "لا", "خطأ", "غلط", "خ"]);

/** Accepts the several ways an operator might write a boolean in a spreadsheet. */
export function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      fields.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function detectDelimiter(line: string): string {
  const candidates = ["\t", "،", ";", ","];
  for (const candidate of candidates) {
    if (line.includes(candidate)) return candidate;
  }
  return ",";
}

function isHeaderRow(fields: readonly string[]): boolean {
  const known = new Set([
    "word",
    "text",
    "كلمة",
    "الكلمة",
    "dialect",
    "pool",
    "notes",
    "ملاحظات",
    "link",
    "url",
    "رابط",
  ]);
  return fields.some((field) => known.has(field.trim().toLowerCase()));
}

type ColumnMap = {
  text: number;
  dialect?: number;
  pool?: number;
  notes?: number;
  link?: number;
};

function mapHeader(fields: readonly string[]): ColumnMap {
  const indexOf = (...names: string[]) =>
    fields.findIndex((field) => names.includes(field.trim().toLowerCase()));

  return {
    text: Math.max(0, indexOf("word", "text", "كلمة", "الكلمة")),
    dialect: nonNegative(indexOf("dialect", "لهجة", "سودانية", "سوداني")),
    pool: nonNegative(indexOf("pool", "candidate", "مرشح", "مرشحة", "مرشحون")),
    notes: nonNegative(indexOf("notes", "note", "ملاحظات", "ملاحظة")),
    link: nonNegative(indexOf("link", "url", "رابط")),
  };
}

function nonNegative(value: number): number | undefined {
  return value === -1 ? undefined : value;
}

function rowFromFields(fields: readonly string[], map: ColumnMap): ParsedWord | null {
  const text = fields[map.text]?.trim();
  if (!text) return null;

  const word: ParsedWord = { text };
  if (map.dialect !== undefined) word.dialect = parseFlag(fields[map.dialect]);
  if (map.pool !== undefined) word.pool = parseFlag(fields[map.pool]);
  if (map.notes !== undefined) {
    const notes = fields[map.notes]?.trim();
    if (notes) word.notes = notes;
  }
  if (map.link !== undefined) {
    const link = fields[map.link]?.trim();
    if (link) word.link = link;
  }
  return word;
}

function objectToWord(value: unknown): ParsedWord | null {
  if (typeof value === "string") return { text: value };
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const text = record.text ?? record.word ?? record["كلمة"] ?? record["الكلمة"];
  if (typeof text !== "string" || text.trim() === "") return null;

  const word: ParsedWord = { text: text.trim() };

  const dialect = record.dialect ?? record["لهجة"] ?? record["سودانية"];
  if (typeof dialect === "boolean") word.dialect = dialect;
  else if (typeof dialect === "string") word.dialect = parseFlag(dialect);

  const pool = record.pool ?? record.candidate ?? record["مرشح"];
  if (typeof pool === "boolean") word.pool = pool;
  else if (typeof pool === "string") word.pool = parseFlag(pool);

  const notes = record.notes ?? record.note ?? record["ملاحظات"];
  if (typeof notes === "string" && notes.trim() !== "") word.notes = notes.trim();

  const link = record.link ?? record.url ?? record["رابط"];
  if (typeof link === "string" && link.trim() !== "") word.link = link.trim();

  return word;
}

/** Parses an arbitrary operator payload into structured words. */
export function parseWordPayload(payload: string): { words: ParsedWord[]; truncated: boolean } {
  const text = payload.replace(/^\uFEFF/, "").trim();
  if (text === "") return { words: [], truncated: false };

  const fromJson = tryParseJson(text);
  if (fromJson) return capRows(fromJson);

  // A payload that opens like JSON but did not parse is a malformed file, not a
  // list of words. Reporting zero rows beats reading `{"a":1}` as a word.
  if (text.startsWith("{") || text.startsWith("[")) {
    return { words: [], truncated: false };
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const delimiter = detectDelimiter(lines[0]);
  const firstFields = splitDelimitedLine(lines[0], delimiter);

  const hasHeader = lines.length > 1 && isHeaderRow(firstFields);
  const map: ColumnMap = hasHeader
    ? mapHeader(firstFields)
    : { text: 0, dialect: 1, pool: 2, notes: 3 };

  const body = hasHeader ? lines.slice(1) : lines;
  const words: ParsedWord[] = [];
  for (const line of body) {
    // A line without the delimiter comes back as a single field, which is how a
    // plain one-word-per-line list is read.
    const word = rowFromFields(splitDelimitedLine(line, delimiter), map);
    if (word) words.push(word);
  }
  return capRows(words);
}

/**
 * Parses one JSON document: an array of words, a wrapper object such as
 * `{"words": [...]}`, a single word object, or a bare string.
 *
 * Returns null when the text is not JSON, or when it is JSON that does not
 * describe words — which is how a malformed file is told apart from a word list.
 */
function parseJsonValue(raw: string): ParsedWord[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value === "string") return [{ text: value }];

  if (Array.isArray(value)) {
    const words = value.map(objectToWord).filter((word): word is ParsedWord => word !== null);
    return words.length === value.length ? words : null;
  }

  if (typeof value === "object" && value !== null) {
    const container = value as Record<string, unknown>;
    const list = container.words ?? container.items ?? container["كلمات"];
    if (Array.isArray(list)) {
      const words = list.map(objectToWord).filter((word): word is ParsedWord => word !== null);
      return words.length === list.length ? words : null;
    }
    const single = objectToWord(value);
    return single ? [single] : null;
  }

  return null;
}

function tryParseJson(text: string): ParsedWord[] | null {
  const whole = parseJsonValue(text);
  if (whole) return whole;

  // Newline-delimited JSON: one document per line.
  if (text.includes("\n")) {
    const rows: ParsedWord[] = [];
    let matchedLines = 0;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const parsed = parseJsonValue(trimmed);
      if (!parsed) return null;
      matchedLines += 1;
      rows.push(...parsed);
    }
    if (matchedLines > 0) return rows;
  }

  return null;
}

function capRows(words: ParsedWord[]): { words: ParsedWord[]; truncated: boolean } {
  if (words.length <= MAX_IMPORT_ROWS) return { words, truncated: false };
  return { words: words.slice(0, MAX_IMPORT_ROWS), truncated: true };
}

/** Collapses a parsed payload to one entry per folded spelling. */
function dedupe(words: readonly ParsedWord[]): {
  unique: (ParsedWord & { normalized: string })[];
  duplicates: number;
  invalid: { text: string; reason: string }[];
} {
  const byNormalized = new Map<string, ParsedWord & { normalized: string }>();
  const invalid: { text: string; reason: string }[] = [];
  let duplicates = 0;

  for (const word of words) {
    const trimmed = word.text.trim();
    if (trimmed === "") continue;

    const normalized = normalizeArabic(trimmed);
    const letters = toLetters(trimmed);
    if (letters.length !== WORD_LETTER_COUNT) {
      invalid.push({
        text: trimmed,
        reason: `عدد الحروف ${letters.length} وليس ${WORD_LETTER_COUNT}`,
      });
      continue;
    }
    // Same rule as a word added by hand: every letter must be on the keypad, or
    // the word could be served but never guessed.
    if (!letters.every(isBaseLetter)) {
      invalid.push({ text: trimmed, reason: "تحتوي على حروف غير عربية" });
      continue;
    }
    if (word.dialect === false && word.pool === true) {
      invalid.push({ text: trimmed, reason: "كلمة مرشحة دون أن تكون سودانية" });
      continue;
    }

    const existing = byNormalized.get(normalized);
    if (existing) {
      duplicates += 1;
      // Merge: a flag set anywhere in the payload wins.
      if (word.dialect === true) existing.dialect = true;
      if (word.pool === true) existing.pool = true;
      if (word.notes && !existing.notes) existing.notes = word.notes;
      if (word.link && !existing.link) existing.link = word.link;
      continue;
    }

    byNormalized.set(normalized, { ...word, text: trimmed, normalized });
  }

  return { unique: [...byNormalized.values()], duplicates, invalid };
}

/**
 * Writes parsed words into the dictionary.
 *
 * Re-importing the same list is safe: matching happens on the folded spelling,
 * and flags are only overwritten when the payload explicitly states them.
 */
export async function importWords(
  payload: string,
  defaults: ImportDefaults = {},
): Promise<ImportSummary> {
  await ensureSchema();

  const { words, truncated } = parseWordPayload(payload);
  const { unique, duplicates, invalid } = dedupe(words);

  const summary: ImportSummary = {
    received: words.length,
    inserted: 0,
    matched: 0,
    skipped: [
      ...invalid,
      ...(duplicates > 0 ? [{ text: "—", reason: `تكرار داخل الملف: ${duplicates}` }] : []),
    ],
    truncated,
  };

  if (unique.length === 0) return summary;

  const CHUNK = 1000;
  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const chunk = unique.slice(offset, offset + CHUNK);

    const operations: BulkOperation[] = chunk.map((word) => {
      const setFields: Record<string, unknown> = {};
      const insertFields: Record<string, unknown> = {
        text: word.text,
        normalized: word.normalized,
        letterCount: WORD_LETTER_COUNT,
      };

      // A row's own flags win; otherwise the phase defaults apply.
      const dialect = word.dialect ?? defaults.dialect;
      // A non-Sudanese word can never be a candidate, so an explicit
      // `dialect: false` also cancels the pool default.
      const inPool = word.pool ?? (dialect === false ? false : defaults.pool);

      if (dialect !== undefined) {
        setFields.dialect = dialect;
        if (dialect === false) setFields.pool = false;
      } else {
        insertFields.dialect = false;
      }

      if (inPool !== undefined) {
        setFields.pool = inPool;
        if (inPool === true) setFields.dialect = true;
      } else if (dialect !== false) {
        insertFields.pool = false;
      }

      // Matches the limit on a note typed into the dashboard.
      if (word.notes !== undefined) setFields.notes = word.notes?.slice(0, 500) ?? null;
      else insertFields.notes = null;

      const link = normalizeExternalLink(word.link);
      if (link !== null) setFields.link = link;
      else insertFields.link = null;

      return {
        updateOne: {
          filter: { normalized: word.normalized },
          update: { $set: setFields, $setOnInsert: insertFields },
          upsert: true,
        },
      };
    });

    const result = await Word.bulkWrite(
      operations as unknown as Parameters<typeof Word.bulkWrite>[0],
      { ordered: false },
    );
    summary.inserted += result.upsertedCount;
    summary.matched += result.matchedCount;
  }

  return summary;
}
