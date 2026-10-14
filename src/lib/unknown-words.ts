/**
 * The review queue for words the dictionary does not know.
 *
 * A player who types a word the game rejects is telling us something: either
 * they made it up, or the dictionary is missing a word that is really in use.
 * This module collects those words so the operator can decide, and applies their
 * decision back to the dictionary.
 *
 * Nothing here is on the critical path of a guess: recording is attempted, and
 * a failure to record never changes whether the guess was accepted.
 */

import { normalizeArabic } from "./arabic.ts";
import { ensureSchema } from "./db.ts";
import { Unknown, Word } from "./jradil-model.ts";

export type UnknownWord = {
  id: string;
  /** As first typed by a player. */
  text: string;
  /** How many attempts have been made at it. */
  count: number;
  firstAt: string;
  lastAt: string;
};

type UnknownLike = {
  _id: { toString(): string } | string;
  text: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
};

function toUnknownWord(entry: UnknownLike): UnknownWord {
  return {
    id: String(entry._id),
    text: entry.text,
    count: entry.count,
    firstAt: entry.firstAt.toISOString(),
    lastAt: entry.lastAt.toISOString(),
  };
}

/**
 * Notes that a player tried a word the dictionary does not have.
 *
 * Counted rather than appended: a word players keep reaching for should rise to
 * the top of the queue, and a burst of nonsense should not fill it.
 *
 * Never throws. The caller is in the middle of rejecting a guess, and a failure
 * to record is not worth breaking that over.
 */
export async function recordUnknownWord(text: string): Promise<void> {
  const normalized = normalizeArabic(text);
  // The caller only ever reaches here with a well-formed guess, but a blank
  // would otherwise queue a row with an empty key and never match anything again.
  if (normalized === "") return;

  try {
    await ensureSchema();
    const now = new Date();
    await Unknown.updateOne(
      { normalized },
      {
        $inc: { count: 1 },
        $set: { lastAt: now },
        $setOnInsert: { text: text.trim(), normalized, firstAt: now },
      },
      { upsert: true },
    );
  } catch (error) {
    console.warn("[jradil] تعذّر تسجيل كلمة غير موجودة في القاموس:", error);
  }
}

export type UnknownWordsPage = {
  items: UnknownWord[];
  total: number;
  page: number;
  pageSize: number;
};

/** The queue, most-tried first so the operator reviews the loudest ones first. */
export async function listUnknownWords(
  query: { page?: number; pageSize?: number } = {},
): Promise<UnknownWordsPage> {
  await ensureSchema();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 30)));

  const [entries, total] = await Promise.all([
    Unknown.find({})
      .sort({ count: -1, lastAt: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Unknown.countDocuments({}),
  ]);

  return {
    items: (entries as unknown as UnknownLike[]).map(toUnknownWord),
    total,
    page,
    pageSize,
  };
}

export async function countUnknownWords(): Promise<number> {
  await ensureSchema();
  return Unknown.countDocuments({});
}

/** Every queued word, for the "add them all" path. */
async function allQueued(): Promise<UnknownLike[]> {
  const entries = await Unknown.find({}).sort({ count: -1 }).lean();
  return entries as unknown as UnknownLike[];
}

export type AddUnknownResult = {
  /** Words that became dictionary entries. */
  added: number;
  /** Words already in the dictionary, so only the queue entry was cleared. */
  alreadyKnown: number;
};

/**
 * Moves queued words into the dictionary and clears them from the queue.
 *
 * `ids === null` means everything queued. A word already in the dictionary is
 * counted as `alreadyKnown` rather than added twice — its queue entry still
 * goes, because the dictionary does have it.
 *
 * `dialect` decides whether these become eligible to be the word of the day.
 * It defaults off: a word a player reached for is known to be a valid guess but
 * is not thereby a word worth serving.
 */
export async function addUnknownWords(
  ids: readonly string[] | null,
  options: { dialect?: boolean } = {},
): Promise<AddUnknownResult> {
  await ensureSchema();

  const queued = ids === null ? await allQueued() : await queuedByIds(ids);
  if (queued.length === 0) return { added: 0, alreadyKnown: 0 };

  const dialect = options.dialect ?? false;
  const normalized = queued.map((entry) => normalizeArabic(entry.text));

  const existing = await Word.find({ normalized: { $in: normalized } })
    .select({ normalized: 1 })
    .lean();
  const known = new Set(
    (existing as unknown as { normalized: string }[]).map((word) => word.normalized),
  );

  const fresh = queued.filter((entry) => !known.has(normalizeArabic(entry.text)));

  if (fresh.length > 0) {
    await Word.insertMany(
      fresh.map((entry) => ({
        text: entry.text,
        normalized: normalizeArabic(entry.text),
        letterCount: Array.from(normalizeArabic(entry.text)).length,
        dialect,
        pool: false,
        notes: `أضافها المشرف من محاولات اللاعبين (${entry.count} محاولة)`,
      })),
      // One already-known word should not stop the rest from landing.
      { ordered: false },
    );
  }

  // Entries are cleared either way: the dictionary knows these words now.
  await Unknown.deleteMany({ _id: { $in: queued.map((entry) => entry._id) } });

  return { added: fresh.length, alreadyKnown: queued.length - fresh.length };
}

async function queuedByIds(ids: readonly string[]): Promise<UnknownLike[]> {
  if (ids.length === 0) return [];
  const entries = await Unknown.find({ _id: { $in: ids } }).lean();
  return entries as unknown as UnknownLike[];
}

/**
 * Drops queued words without adding them.
 *
 * Needed, not optional: players mistype, and without a way to clear them the
 * queue would only ever grow.
 */
export async function forgetUnknownWords(
  ids: readonly string[] | null,
): Promise<{ removed: number }> {
  await ensureSchema();
  const result =
    ids === null ? await Unknown.deleteMany({}) : await Unknown.deleteMany({ _id: { $in: ids } });
  return { removed: result.deletedCount };
}
