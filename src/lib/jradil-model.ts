/**
 * The whole application state lives in one MongoDB collection named `jradil`.
 *
 * A single collection holding three different record shapes is modelled with
 * Mongoose discriminators: the base model pins the collection and the
 * discriminator key (called `kind`, not Mongoose's default `__t`), and each
 * shape is a strict child schema. Mongoose clones the base schema options onto
 * every child, so `collection`, `timestamps` and `autoIndex` stay consistent.
 *
 * - `kind: "word"`     — one valid five-letter Arabic word. A subset is flagged
 *                        `dialect` (كلمات سودانية) and a subset of those forms
 *                        the auto-pick candidate pool.
 * - `kind: "day"`      — the puzzle actually served on one Sudan calendar day,
 *                        plus a revision log of every change the operator made.
 * - `kind: "settings"` — the singleton operator settings document.
 *
 * Unique indexes are scoped to their kind with `partialFilterExpression`, so
 * "unique per collection" becomes "unique per record shape".
 */

import mongoose, { Schema } from "mongoose";

import { COLLECTION_NAME, DEFAULT_POOL_SIZE, WORD_LETTER_COUNT } from "./config.ts";

/** Discriminator key. Named `kind` so raw documents read clearly in Atlas. */
export const DOC_KIND_KEY = "kind";

/** The single settings document is addressed by this key. */
export const SETTINGS_KEY = "app";

export const DAY_SOURCES = ["admin", "auto"] as const;
export type DaySource = (typeof DAY_SOURCES)[number];

/** Mongoose adds these through the `timestamps` option. */
export type Timestamps = { createdAt: Date; updatedAt: Date };

// ---------------------------------------------------------------- schemas --

const revisionSchema = new Schema(
  {
    wordText: { type: String, required: true },
    source: { type: String, enum: DAY_SOURCES, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const wordSchema = new Schema({
  /** Display form exactly as the operator wants it shown, e.g. `مدرسة`. */
  text: { type: String, required: true, trim: true },
  /** Folded comparison form derived from `text`. Uniqueness is based on it. */
  normalized: { type: String, required: true },
  /** Always {@link WORD_LETTER_COUNT}. Stored so imports can be validated. */
  letterCount: { type: Number, required: true },
  /** Sudanese dialect word: eligible to be served as the word of the day. */
  dialect: { type: Boolean, required: true, default: false },
  /** Member of the auto-pick candidate pool. Implies `dialect`. */
  pool: { type: Boolean, required: true, default: false },
  /** Free note for the operator. */
  notes: { type: String, default: null },
  /**
   * Optional external page about the word — a dictionary entry, an article.
   * Shown to the player once the puzzle is over.
   */
  link: { type: String, default: null },
  /** Day this word is currently bound to: served, or scheduled ahead. */
  assignedDateKey: { type: String, default: null },
  /** First day the word was ever served to players. */
  firstServedDateKey: { type: String, default: null },
  /** Most recent day the word was served. */
  lastServedDateKey: { type: String, default: null },
  /** How many times the word has been served. */
  timesServed: { type: Number, required: true, default: 0 },
});

wordSchema.index(
  { normalized: 1 },
  { name: "word_normalized_unique", unique: true, partialFilterExpression: { kind: "word" } },
);
wordSchema.index({ text: 1 }, { name: "word_text" });
// The operator's word list is sorted newest first.
wordSchema.index({ createdAt: -1, _id: -1 }, { name: "word_recent" });
wordSchema.index(
  { dialect: 1, pool: 1, assignedDateKey: 1, firstServedDateKey: 1 },
  { name: "word_pool_lookup" },
);

const daySchema = new Schema({
  /** Sudan calendar day as `YYYY-MM-DD`. */
  dateKey: { type: String, required: true },
  /** The word document, when it still exists. */
  wordId: { type: Schema.Types.ObjectId, default: null },
  /** Denormalised so the history survives a word being deleted. */
  wordText: { type: String, required: true },
  wordNormalized: { type: String, required: true },
  source: { type: String, enum: DAY_SOURCES, required: true },
  /** Every assignment this day has had, oldest first. */
  revisions: { type: [revisionSchema], default: [] },
});

daySchema.index(
  { dateKey: 1 },
  { name: "day_datekey_unique", unique: true, partialFilterExpression: { kind: "day" } },
);

const settingsSchema = new Schema({
  key: { type: String, required: true },
  /** How many candidates the operator wants in the auto-pick pool. */
  poolSize: { type: Number, required: true, default: DEFAULT_POOL_SIZE, min: 1 },
  /** Reject guesses that are not present in the dictionary. */
  enforceDictionary: { type: Boolean, required: true, default: true },
  /**
   * Key for the players' progress tokens (see `progress.ts`). Generated on first
   * use and never sent to a client.
   */
  secret: { type: String, default: null },
});

settingsSchema.index(
  { key: 1 },
  { name: "settings_key_unique", unique: true, partialFilterExpression: { kind: "settings" } },
);

// ------------------------------------------------------------- domain types --

export type WordRecord = mongoose.InferSchemaType<typeof wordSchema> & Timestamps;
export type DayRecord = mongoose.InferSchemaType<typeof daySchema> & Timestamps;
export type SettingsRecord = mongoose.InferSchemaType<typeof settingsSchema> & Timestamps;
export type DayRevision = mongoose.InferSchemaType<typeof revisionSchema>;

export type WordDocument = mongoose.HydratedDocument<WordRecord>;
export type DayDocument = mongoose.HydratedDocument<DayRecord>;
export type SettingsDocument = mongoose.HydratedDocument<SettingsRecord>;

export type Models = {
  Base: mongoose.Model<Record<string, unknown>>;
  Word: mongoose.Model<WordRecord, Record<string, never>, Record<string, never>>;
  Day: mongoose.Model<DayRecord, Record<string, never>, Record<string, never>>;
  Settings: mongoose.Model<SettingsRecord, Record<string, never>, Record<string, never>>;
};

// ---------------------------------------------------------------- models --

const baseSchema = new Schema(
  {},
  {
    collection: COLLECTION_NAME,
    discriminatorKey: DOC_KIND_KEY,
    timestamps: true,
    versionKey: false,
    minimize: false,
    autoIndex: false,
  },
);

function buildModels(): Models {
  const Base =
    (mongoose.models.Jradil as mongoose.Model<Record<string, unknown>> | undefined) ??
    mongoose.model<Record<string, unknown>>("Jradil", baseSchema);

  const registered = (Base.discriminators ?? {}) as Partial<Models>;

  const Word =
    registered.Word ?? (Base.discriminator("word", wordSchema) as unknown as Models["Word"]);
  const Day = registered.Day ?? (Base.discriminator("day", daySchema) as unknown as Models["Day"]);
  const Settings =
    registered.Settings ??
    (Base.discriminator("settings", settingsSchema) as unknown as Models["Settings"]);

  return { Base, Word, Day, Settings };
}

const globalForModels = globalThis as unknown as { __jradilModels?: Models };

const models: Models = globalForModels.__jradilModels ?? buildModels();
globalForModels.__jradilModels = models;

/** The models the data layer uses. All three share the `jradil` collection. */
export const Word = models.Word;
export const Day = models.Day;
export const Settings = models.Settings;

export { WORD_LETTER_COUNT };
