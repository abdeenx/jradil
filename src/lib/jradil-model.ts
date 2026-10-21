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
 * - `kind: "unknown"`  — a word players tried that the dictionary lacks.
 * - `kind: "subscription"` — one browser that asked for the daily notification.
 *
 * Unique indexes are scoped to their kind with `partialFilterExpression`, so
 * "unique per collection" becomes "unique per record shape".
 */

import mongoose, { Schema } from "mongoose";

import { COLLECTION_NAME, DEFAULT_POOL_SIZE, WORD_LETTER_COUNT } from "./config.ts";
import { DEFAULT_NOTIFY_TIME } from "./notifications.ts";

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

/** The last daily send, for the dashboard. */
const notifyRunSchema = new Schema(
  {
    dateKey: { type: String, required: true },
    at: { type: Date, required: true },
    /** Subscriptions the push services accepted the notification for. */
    delivered: { type: Number, required: true },
    /** Refused this time; kept, and dropped after several refusals in a row. */
    failed: { type: Number, required: true },
    /** Gone for good, and deleted. */
    removed: { type: Number, required: true },
  },
  { _id: false },
);

/** The last notification the operator sent by hand, for the dashboard. */
const notifyBroadcastSchema = new Schema(
  {
    at: { type: Date, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    delivered: { type: Number, required: true },
    failed: { type: Number, required: true },
    removed: { type: Number, required: true },
  },
  { _id: false },
);

const notificationsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true, default: true },
    /** Sudan-local send time. */
    hour: { type: Number, required: true, default: DEFAULT_NOTIFY_TIME.hour, min: 0, max: 23 },
    minute: { type: Number, required: true, default: DEFAULT_NOTIFY_TIME.minute, min: 0, max: 59 },
    /** Operator wording; null means the built-in text. */
    title: { type: String, default: null },
    body: { type: String, default: null },
    /**
     * The day the notification was last claimed for. Written before sending, by
     * a conditional update, so two ticks or two containers cannot both send.
     */
    lastSentDateKey: { type: String, default: null },
    lastRun: { type: notifyRunSchema, default: null },
    /**
     * A manual send holds this until shortly after it finishes. Claimed with a
     * conditional write, so a double click or a second tab cannot send twice.
     */
    broadcastLockedUntil: { type: Date, default: null },
    lastBroadcast: { type: notifyBroadcastSchema, default: null },
  },
  { _id: false },
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
  notifications: { type: notificationsSchema, default: () => ({}) },
  /**
   * The VAPID key pair that signs push requests. Generated on first use, like
   * `secret`; the public half is handed to browsers, the private half never
   * leaves the server. Replacing it orphans every existing subscription.
   */
  vapidPublicKey: { type: String, default: null },
  vapidPrivateKey: { type: String, default: null },
});

settingsSchema.index(
  { key: 1 },
  { name: "settings_key_unique", unique: true, partialFilterExpression: { kind: "settings" } },
);

/**
 * A word a player submitted that the dictionary does not contain.
 *
 * Not a dictionary entry and not part of a day: a review queue. Players are the
 * best source of what the dictionary is missing, and this is how those words
 * reach the operator. Keyed on the folded spelling, so the same word typed
 * repeatedly counts up rather than filling the queue with duplicates.
 */
const unknownSchema = new Schema({
  /** As first typed, for display. */
  text: { type: String, required: true },
  /** Folded spelling. Uniqueness and lookups are based on this. */
  normalized: { type: String, required: true },
  /** How many times players have tried it. */
  count: { type: Number, required: true, default: 1 },
  firstAt: { type: Date, required: true },
  lastAt: { type: Date, required: true },
});

unknownSchema.index(
  { normalized: 1 },
  { name: "unknown_normalized_unique", unique: true, partialFilterExpression: { kind: "unknown" } },
);
// The queue is read most recently tried first, and cleared wholesale when reviewed.
unknownSchema.index({ lastAt: -1 }, { name: "unknown_last_at" });

/**
 * A browser that asked for the daily notification.
 *
 * Nothing here identifies a person: an endpoint at a push service and the two
 * keys that encrypt messages for it. No account, no address, no IP.
 */
const subscriptionSchema = new Schema({
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  /** Consecutive refused deliveries; reset by a success or a resubscribe. */
  failures: { type: Number, required: true, default: 0 },
});

subscriptionSchema.index(
  { endpoint: 1 },
  {
    name: "subscription_endpoint_unique",
    unique: true,
    partialFilterExpression: { kind: "subscription" },
  },
);

// ------------------------------------------------------------- domain types --

export type WordRecord = mongoose.InferSchemaType<typeof wordSchema> & Timestamps;
export type DayRecord = mongoose.InferSchemaType<typeof daySchema> & Timestamps;
export type SettingsRecord = mongoose.InferSchemaType<typeof settingsSchema> & Timestamps;
export type UnknownRecord = mongoose.InferSchemaType<typeof unknownSchema> & Timestamps;
export type SubscriptionRecord = mongoose.InferSchemaType<typeof subscriptionSchema> & Timestamps;
export type DayRevision = mongoose.InferSchemaType<typeof revisionSchema>;

export type WordDocument = mongoose.HydratedDocument<WordRecord>;
export type DayDocument = mongoose.HydratedDocument<DayRecord>;
export type SettingsDocument = mongoose.HydratedDocument<SettingsRecord>;
export type UnknownDocument = mongoose.HydratedDocument<UnknownRecord>;

export type Models = {
  Base: mongoose.Model<Record<string, unknown>>;
  Word: mongoose.Model<WordRecord, Record<string, never>, Record<string, never>>;
  Day: mongoose.Model<DayRecord, Record<string, never>, Record<string, never>>;
  Settings: mongoose.Model<SettingsRecord, Record<string, never>, Record<string, never>>;
  Unknown: mongoose.Model<UnknownRecord, Record<string, never>, Record<string, never>>;
  Subscription: mongoose.Model<SubscriptionRecord, Record<string, never>, Record<string, never>>;
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

  const Unknown =
    registered.Unknown ??
    (Base.discriminator("unknown", unknownSchema) as unknown as Models["Unknown"]);

  const Subscription =
    registered.Subscription ??
    (Base.discriminator("subscription", subscriptionSchema) as unknown as Models["Subscription"]);

  return { Base, Word, Day, Settings, Unknown, Subscription };
}

const globalForModels = globalThis as unknown as { __jradilModels?: Models };

const models: Models = globalForModels.__jradilModels ?? buildModels();
globalForModels.__jradilModels = models;

/** The models the data layer uses. All three share the `jradil` collection. */
export const Word = models.Word;
export const Day = models.Day;
export const Settings = models.Settings;
export const Unknown = models.Unknown;
export const Subscription = models.Subscription;

export { WORD_LETTER_COUNT };
