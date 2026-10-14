/**
 * Operator API.
 *
 * Every function here calls `requireAdmin()` first, which validates the signed
 * session cookie. Nothing in this module is safe to expose to players.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  clearSession,
  isAdminConfigured,
  issueSession,
  loginBlockedFor,
  loginIdentifier,
  readSession,
  recordLoginFailure,
  recordLoginSuccess,
  requireAdmin,
  verifyPassword,
  type AdminSession,
} from "#/lib/admin-auth.ts";
import { toLetters } from "#/lib/arabic.ts";
import { WORD_LETTER_COUNT } from "#/lib/config.ts";
import {
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  parseNotifyTime,
  type NotificationSettings,
} from "#/lib/notifications.ts";
import {
  broadcastNotification,
  countSubscriptions,
  lastBroadcast,
  lastDailyRun,
  sendTestNotification,
  type BroadcastResult,
  type LastBroadcast,
  type LastRun,
  type TestSendResult,
} from "#/lib/push.ts";
import { addDays, isDateKey, sudanDateKey, type DateKey } from "#/lib/sudan-time.ts";
import {
  addUnknownWords,
  countUnknownWords,
  forgetUnknownWords,
  listUnknownWords,
  type AddUnknownResult,
  type UnknownWordsPage,
} from "#/lib/unknown-words.ts";
import { importWords, type ImportSummary } from "#/lib/word-import.ts";
import {
  bulkUpdateWords,
  clearDayWord,
  createWord,
  deleteWord,
  getDay,
  getSettings,
  getStats,
  getWordByText,
  listDays,
  listUsedWords,
  listWords,
  type UsedWordsPage,
  poolStatus,
  resolveDay,
  setDayWord,
  topUpPool,
  updateSettings,
  updateWord,
  type DashboardStats,
  type DayResolution,
  type DayView,
  type PoolStatus,
  type SettingsView,
  type WordView,
} from "#/lib/words.ts";

// -------------------------------------------------------------- session --

export const getAdminSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminSession> => readSession(),
);

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1).max(512) }))
  .handler(
    async ({ data }): Promise<{ ok: true; expiresAt: number } | { ok: false; message: string }> => {
      if (!isAdminConfigured()) {
        return {
          ok: false,
          message: "لم يُضبط ADMIN_PASSWORD على الخادم بعد. أضفه إلى ملف .env ثم أعد التشغيل.",
        };
      }

      const identifier = loginIdentifier();
      const blockedFor = loginBlockedFor(identifier);
      if (blockedFor > 0) {
        const minutes = Math.ceil(blockedFor / 60_000);
        return { ok: false, message: `تم إيقاف المحاولات مؤقتًا. حاول بعد ${minutes} دقيقة.` };
      }

      if (!verifyPassword(data.password)) {
        recordLoginFailure(identifier);
        return { ok: false, message: "كلمة المرور غير صحيحة" };
      }

      recordLoginSuccess(identifier);
      return { ok: true, expiresAt: issueSession() };
    },
  );

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  clearSession();
  return { ok: true };
});

// ------------------------------------------------------------ dashboard --

export type DashboardPayload = {
  today: DateKey;
  tomorrow: DateKey;
  todayResolution: DayResolution;
  tomorrowScheduled: DayView | null;
  stats: DashboardStats;
  settings: SettingsView;
  /** Every word that has already had its day, so a manual repeat is a choice. */
  usedWords: UsedWordsPage;
  /** How many words players tried that the dictionary does not have. */
  unknownCount: number;
};

export const getDashboard = createServerFn({ method: "GET" })
  .validator(z.object({ usedPage: z.number().int().min(1).max(10_000).optional() }).optional())
  .handler(async ({ data }): Promise<DashboardPayload> => {
    requireAdmin();

    const today = sudanDateKey();
    const tomorrow = addDays(today, 1);

    // Today is resolved first: doing it in parallel with `getStats` would let the
    // pool runway report a candidate the day has already consumed.
    const todayResolution = await resolveDay(today);

    const [tomorrowScheduled, stats, settings, usedWords, unknownCount] = await Promise.all([
      getDay(tomorrow),
      getStats(),
      getSettings(),
      listUsedWords({ page: data?.usedPage ?? 1, pageSize: 20 }),
      countUnknownWords(),
    ]);

    return {
      today,
      tomorrow,
      todayResolution,
      tomorrowScheduled,
      stats,
      settings,
      usedWords,
      unknownCount,
    };
  });

// ---------------------------------------------------------------- words --

/** A Mongo ObjectId, checked here so a malformed id is a validation error rather than a CastError. */
const wordId = z.string().regex(/^[a-f\d]{24}$/i);

const dateKeyInput = z.string().length(10);

const wordPatch = {
  dialect: z.boolean().optional(),
  pool: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  link: z.string().max(2000).nullable().optional(),
};

export const adminListWords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      search: z.string().max(200).optional(),
      dialect: z.boolean().optional(),
      pool: z.boolean().optional(),
      served: z.boolean().optional(),
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return listWords(data);
  });

export const adminAddWord = createServerFn({ method: "POST" })
  .validator(
    z.object({
      text: z.string().min(1).max(100),
      ...wordPatch,
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return createWord(data);
  });

export const adminUpdateWord = createServerFn({ method: "POST" })
  .validator(z.object({ id: wordId, ...wordPatch }))
  .handler(async ({ data }) => {
    requireAdmin();
    const { id, ...patch } = data;
    return updateWord(id, patch);
  });

export const adminDeleteWord = createServerFn({ method: "POST" })
  .validator(z.object({ id: wordId }))
  .handler(async ({ data }) => {
    requireAdmin();
    return deleteWord(data.id);
  });

export const adminBulkUpdateWords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ids: z.array(wordId).max(2000),
      dialect: z.boolean().optional(),
      pool: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    const result = await bulkUpdateWords(data.ids, {
      dialect: data.dialect,
      pool: data.pool,
    });
    return { modified: result.modified, status: await poolStatus() };
  });

export const adminTopUpPool = createServerFn({ method: "POST" })
  .validator(z.object({ target: z.number().int().min(1).max(500).optional() }))
  .handler(async ({ data }): Promise<{ added: number; status: PoolStatus }> => {
    requireAdmin();
    const settings = await getSettings();
    const result = await topUpPool(data.target ?? settings.poolSize);
    return { added: result.added, status: result.pool };
  });

export const adminImportWords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      payload: z.string().min(1).max(20_000_000),
      dialect: z.boolean().optional(),
      pool: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<ImportSummary> => {
    requireAdmin();
    return importWords(data.payload, { dialect: data.dialect, pool: data.pool });
  });

/** Looks a word up before the operator commits to it as the word of the day. */
export const adminPreviewWord = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().min(1).max(100) }))
  .handler(
    async ({ data }): Promise<{ found: WordView | null; letterCount: number; valid: boolean }> => {
      requireAdmin();
      const letters = toLetters(data.text);
      return {
        found: await getWordByText(data.text),
        letterCount: letters.length,
        valid: letters.length === WORD_LETTER_COUNT,
      };
    },
  );

// ------------------------------------------------------- unknown words --

/** The queue of words players tried that the dictionary does not have. */
export const adminListUnknownWords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(async ({ data }): Promise<UnknownWordsPage> => {
    requireAdmin();
    return listUnknownWords(data);
  });

/**
 * Adds queued words to the dictionary. An empty `ids` means the whole queue.
 */
export const adminAddUnknownWords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ids: z.array(z.string().min(1)).max(2000),
      dialect: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<AddUnknownResult> => {
    requireAdmin();
    // An empty selection is read as "all of them", which is what the button means.
    return addUnknownWords(data.ids.length === 0 ? null : data.ids, {
      dialect: data.dialect,
    });
  });

/** Drops queued words without adding them. An empty `ids` clears the queue. */
export const adminForgetUnknownWords = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.string().min(1)).max(2000) }))
  .handler(async ({ data }): Promise<{ removed: number }> => {
    requireAdmin();
    return forgetUnknownWords(data.ids.length === 0 ? null : data.ids);
  });

// ----------------------------------------------------------------- days --

export const adminSetDayWord = createServerFn({ method: "POST" })
  .validator(
    z.object({
      dateKey: dateKeyInput,
      text: z.string().min(1).max(100),
      allowNonDialect: z.boolean().optional(),
      createIfMissing: z.boolean().optional(),
      /** Set once the operator has seen the "already used" warning and agreed. */
      allowRepeat: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    if (!isDateKey(data.dateKey)) {
      return { ok: false as const, code: "bad-date" as const, reason: "تاريخ غير صالح" };
    }
    return setDayWord(data.dateKey, data.text, {
      allowNonDialect: data.allowNonDialect,
      createIfMissing: data.createIfMissing,
      allowRepeat: data.allowRepeat,
    });
  });

export const adminClearDayWord = createServerFn({ method: "POST" })
  .validator(z.object({ dateKey: dateKeyInput }))
  .handler(async ({ data }) => {
    requireAdmin();
    if (!isDateKey(data.dateKey)) {
      return { ok: false as const, code: "bad-date" as const, reason: "تاريخ غير صالح" };
    }
    return clearDayWord(data.dateKey);
  });

export const adminListDays = createServerFn({ method: "POST" })
  .validator(
    z.object({
      from: dateKeyInput.optional(),
      to: dateKeyInput.optional(),
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    return listDays({
      from: isDateKey(data.from) ? data.from : undefined,
      to: isDateKey(data.to) ? data.to : undefined,
      page: data.page,
      pageSize: data.pageSize,
    });
  });

// ------------------------------------------------------------- settings --

/** Read-only view of the operator settings, for the pages that need one switch. */
export const adminGetSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsView> => {
    requireAdmin();
    return getSettings();
  },
);

export const adminUpdateSettings = createServerFn({ method: "POST" })
  .validator(
    z.object({
      poolSize: z.number().int().min(1).max(500).optional(),
      enforceDictionary: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<SettingsView> => {
    requireAdmin();
    return updateSettings(data);
  });

// -------------------------------------------------------- notifications --

export type NotificationsPayload = {
  today: DateKey;
  settings: NotificationSettings;
  /** Browsers currently subscribed. */
  subscribers: number;
  lastRun: LastRun | null;
  lastBroadcast: LastBroadcast | null;
};

export const adminGetNotifications = createServerFn({ method: "GET" }).handler(
  async (): Promise<NotificationsPayload> => {
    requireAdmin();
    const [settings, subscribers, lastRun, broadcast] = await Promise.all([
      getSettings(),
      countSubscriptions(),
      lastDailyRun(),
      lastBroadcast(),
    ]);
    return {
      today: sudanDateKey(),
      settings: settings.notifications,
      subscribers,
      lastRun,
      lastBroadcast: broadcast,
    };
  },
);

/** Operator copy; an empty string means "back to the default wording". */
const notifyText = (max: number) => z.string().max(max).nullable();

export const adminUpdateNotifications = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean().optional(),
      /** `HH:MM`, Sudan time — what a time input produces. */
      time: z.string().max(5).optional(),
      title: notifyText(NOTIFY_TITLE_MAX).optional(),
      body: notifyText(NOTIFY_BODY_MAX).optional(),
    }),
  )
  .handler(
    async ({ data }): Promise<{ ok: true; settings: NotificationSettings } | { ok: false }> => {
      requireAdmin();
      const time = data.time === undefined ? undefined : parseNotifyTime(data.time);
      if (time === null) return { ok: false };

      const settings = await updateSettings({
        notifications: { enabled: data.enabled, time, title: data.title, body: data.body },
      });
      return { ok: true, settings: settings.notifications };
    },
  );

/** Sends the given wording to the operator's own browser only. */
export const adminSendTestNotification = createServerFn({ method: "POST" })
  .validator(
    z.object({
      endpoint: z.string().min(1).max(2000),
      title: notifyText(NOTIFY_TITLE_MAX),
      body: notifyText(NOTIFY_BODY_MAX),
    }),
  )
  .handler(async ({ data }): Promise<TestSendResult> => {
    requireAdmin();
    return sendTestNotification(data.endpoint, {
      title: data.title?.trim() || null,
      body: data.body?.trim() || null,
    });
  });

/** Sends the operator's own message to every subscriber, right now. */
export const adminBroadcastNotification = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().trim().min(1).max(NOTIFY_TITLE_MAX),
      body: z.string().trim().min(1).max(NOTIFY_BODY_MAX),
    }),
  )
  .handler(async ({ data }): Promise<BroadcastResult> => {
    requireAdmin();
    return broadcastNotification(data);
  });
