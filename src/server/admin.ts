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
import { addDays, isDateKey, sudanDateKey, type DateKey } from "#/lib/sudan-time.ts";
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

    const [tomorrowScheduled, stats, settings, usedWords] = await Promise.all([
      getDay(tomorrow),
      getStats(),
      getSettings(),
      listUsedWords({ page: data?.usedPage ?? 1, pageSize: 20 }),
    ]);

    return {
      today,
      tomorrow,
      todayResolution,
      tomorrowScheduled,
      stats,
      settings,
      usedWords,
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
