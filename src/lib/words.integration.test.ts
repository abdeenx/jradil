/**
 * Integration tests for the puzzle's data layer.
 *
 * These need a live MongoDB. They are skipped when `MONGODB_URI` is not set, so
 * `vp test` stays green on a machine with no database, and they run for real
 * wherever the connection string exists.
 *
 * Every run creates its own scratch database and drops it afterwards, so the
 * configured database is never touched.
 */

import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { connectDb, ensureSchema } from "./db.ts";
import { loadEnv } from "./env.ts";
import { Word } from "./jradil-model.ts";
import { addDays, sudanDateKey } from "./sudan-time.ts";
import { importWords } from "./word-import.ts";
import {
  bulkUpdateWords,
  clearDayWord,
  getSettings,
  getWordByText,
  listDays,
  listUsedWords,
  listWords,
  poolStatus,
  resolveDay,
  setDayWord,
  topUpPool,
  updateSettings,
  updateWord,
} from "./words.ts";

loadEnv();

const connectionString = process.env.MONGODB_URI;
const scratchDatabase = `jradil_test_${Date.now()}`;

const today = sudanDateKey();
const tomorrow = addDays(today, 1);

describe.skipIf(!connectionString)("words against a live MongoDB", () => {
  beforeAll(async () => {
    // Must be set before the first connection, which `db.ts` opens lazily.
    process.env.MONGODB_DB = scratchDatabase;
    await connectDb();
    await ensureSchema();
    await importWords(
      [
        "مدرسه",
        "جامعه",
        "طنجره,1,1",
        "بابور,1,1",
        "عربيه,1,1",
        "جوافه,1,0",
        "عصيده,1,0",
        "حاسوب,0,0",
        "ملعقه,0,0",
        "زيتون,0,0",
      ].join("\n"),
    );
  }, 30_000);

  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
  });

  describe("storage shape", () => {
    it("keeps every record in the single jradil collection, tagged by kind", async () => {
      // Creates the settings singleton, so two of the three shapes exist.
      await getSettings();

      const kinds = await Word.db
        .collection("jradil")
        .aggregate([{ $group: { _id: "$kind", n: { $sum: 1 } } }])
        .toArray();
      const names = kinds.map((entry) => entry._id);
      expect(names).toContain("word");
      expect(names).toContain("settings");
      expect(names.every((name) => ["word", "day", "settings"].includes(name))).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    });

    it("scopes the word uniqueness index to kind=word", async () => {
      const indexes = await Word.db.collection("jradil").indexes();
      const unique = indexes.find((index) => index.name === "word_normalized_unique");
      expect(unique?.unique).toBe(true);
      expect(unique?.partialFilterExpression).toMatchObject({ kind: "word" });

      const dayIndex = indexes.find((index) => index.name === "day_datekey_unique");
      expect(dayIndex?.unique).toBe(true);
    });

    it("refuses a second row with the same folded spelling", async () => {
      await expect(
        Word.db
          .collection("jradil")
          .insertOne({ kind: "word", text: "نسخة", normalized: "مدرسه", letterCount: 5 }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe("dictionary", () => {
    it("counts the imported words and their flags", async () => {
      const all = await listWords({ pageSize: 100 });
      const dialect = await listWords({ dialect: true, pageSize: 100 });
      const pool = await listWords({ pool: true, pageSize: 100 });
      expect(all.total).toBe(10);
      expect(dialect.total).toBe(5);
      expect(pool.total).toBe(3);
    });

    it("matches a search after folding the query", async () => {
      await importWords('["أسعار"]');
      const found = await listWords({ search: "اسعار", pageSize: 10 });
      expect(found.total).toBe(1);
      expect(found.items[0]?.text).toBe("أسعار");
    });

    it("is idempotent, so re-importing a list creates nothing new", async () => {
      const before = await listWords({ pageSize: 1 });
      const summary = await importWords("مدرسه\nجامعه");
      const after = await listWords({ pageSize: 1 });
      expect(summary.inserted).toBe(0);
      expect(summary.matched).toBe(2);
      expect(after.total).toBe(before.total);
    });

    it("refuses a five-letter word that could never be typed on the keypad", async () => {
      const summary = await importWords("hello\nمدرسa");
      expect(summary.inserted).toBe(0);
      expect(summary.skipped).toHaveLength(2);
    });
  });

  describe("settings and pool", () => {
    it("creates the settings singleton with the documented default", async () => {
      await expect(getSettings()).resolves.toMatchObject({ poolSize: 30, enforceDictionary: true });
    });

    it("reports pool availability", async () => {
      const pool = await poolStatus();
      expect(pool).toMatchObject({ target: 30, flagged: 3, available: 3, spent: 0 });
      expect(pool.addable).toBe(2);
    });

    it("fills the pool up to the target and then stops", async () => {
      const filled = await topUpPool(5);
      expect(filled.added).toBe(2);
      expect(filled.pool.flagged).toBe(5);
      const again = await topUpPool(5);
      expect(again.added).toBe(0);
    });
  });

  describe("operator scheduling", () => {
    it("uses the operator's word and attributes it to them", async () => {
      await expect(setDayWord(tomorrow, "طنجره")).resolves.toMatchObject({ ok: true });
      const resolved = await resolveDay(tomorrow);
      expect(resolved).toMatchObject({
        status: "ready",
        day: { wordText: "طنجره", source: "admin" },
      });
    });

    it("reserves a scheduled word without marking it served", async () => {
      const row = await Word.findOne({ text: "طنجره" }).lean();
      expect(row?.assignedDateKey).toBe(tomorrow);
      expect(row?.firstServedDateKey).toBeNull();
    });

    it("refuses to book the same word on two days at once", async () => {
      const clash = await setDayWord(today, "طنجره");
      expect(clash).toMatchObject({ ok: false, code: "reserved" });
    });

    it("returns a released schedule to the pool", async () => {
      await expect(clearDayWord(tomorrow)).resolves.toMatchObject({ ok: true });
      const row = await Word.findOne({ text: "طنجره" }).lean();
      expect(row?.assignedDateKey).toBeNull();
      expect(row?.firstServedDateKey).toBeNull();
    });

    it("rejects a word that is not five Arabic letters", async () => {
      await expect(setDayWord(tomorrow, "مدر")).resolves.toMatchObject({
        ok: false,
        code: "bad-length",
      });
    });

    it("requires the dialect flag unless the operator forces it", async () => {
      await expect(setDayWord(tomorrow, "حاسوب")).resolves.toMatchObject({
        ok: false,
        code: "not-dialect",
      });
      await expect(setDayWord(tomorrow, "حاسوب", { allowNonDialect: true })).resolves.toMatchObject(
        { ok: true },
      );
    });
  });

  describe("automatic pick", () => {
    it("adds day records to the same collection once a puzzle is served", async () => {
      const resolved = await resolveDay(today);
      expect(resolved.status).toBe("ready");

      const kinds = await Word.db
        .collection("jradil")
        .aggregate([{ $group: { _id: "$kind", n: { $sum: 1 } } }])
        .toArray();
      expect(kinds.map((entry) => entry._id)).toContain("day");
    });

    it("picks a word for today and keeps it stable", async () => {
      const first = await resolveDay(today);
      expect(first).toMatchObject({ status: "ready", day: { source: "auto" } });
      const second = await resolveDay(today);
      expect(second).toMatchObject({ status: "ready" });
      expect(second.status === "ready" && first.status === "ready" && second.day.wordText).toBe(
        first.status === "ready" ? first.day.wordText : null,
      );
    });

    it("records that the picked word was served", async () => {
      const day = await resolveDay(today);
      const text = day.status === "ready" ? day.day.wordText : "";
      const row = await Word.findOne({ text }).lean();
      expect(row?.firstServedDateKey).toBe(today);
      expect(row?.lastServedDateKey).toBe(today);
      expect(row?.timesServed).toBe(1);
    });

    it("never repeats a word that was already served", async () => {
      const fresh = await Word.find({ firstServedDateKey: null, dialect: true }).limit(2).lean();
      expect(fresh).toHaveLength(2);

      await Word.updateMany({}, { $set: { pool: false, assignedDateKey: null } });
      await Word.updateMany(
        { _id: { $in: fresh.map((word) => word._id) } },
        { $set: { pool: true } },
      );

      await clearDayWord(today);
      const first = await resolveDay(today);
      await clearDayWord(today);
      const second = await resolveDay(today);

      const firstText = first.status === "ready" ? first.day.wordText : "";
      const secondText = second.status === "ready" ? second.day.wordText : "";
      expect(firstText).not.toBe(secondText);
      expect(fresh.map((word) => word.text).sort()).toEqual([firstText, secondText].sort());
    });

    it("reports an exhausted pool instead of repeating a word", async () => {
      await clearDayWord(today);
      await expect(resolveDay(today)).resolves.toMatchObject({ status: "no-candidates" });
    });

    it("does not back-fill a past day", async () => {
      await expect(resolveDay(addDays(today, -1))).resolves.toMatchObject({
        status: "unresolved",
      });
    });

    it("reports a future day as pending", async () => {
      await expect(resolveDay(addDays(today, 30))).resolves.toMatchObject({ status: "pending" });
    });
  });

  describe("operator override", () => {
    it("wins over the automatic pick and appends a revision", async () => {
      await expect(setDayWord(today, "ملعقه", { allowNonDialect: true })).resolves.toMatchObject({
        ok: true,
      });
      await expect(setDayWord(today, "زيتون", { allowNonDialect: true })).resolves.toMatchObject({
        ok: true,
      });

      const resolved = await resolveDay(today);
      expect(resolved).toMatchObject({
        status: "ready",
        day: { wordText: "زيتون", source: "admin" },
      });
      expect(resolved.status === "ready" && resolved.day.revisions).toHaveLength(2);
    });

    it("records the served day in the history", async () => {
      const history = await listDays({ pageSize: 50 });
      const entry = history.items.find((day) => day.dateKey === today);
      expect(entry).toMatchObject({ wordText: "زيتون", source: "admin" });
    });

    it("honours the dictionary switch", async () => {
      await expect(updateSettings({ enforceDictionary: false })).resolves.toMatchObject({
        enforceDictionary: false,
      });
    });
  });

  describe("word metadata", () => {
    async function idOf(text: string) {
      const found = await getWordByText(text);
      if (!found) throw new Error(`missing fixture word: ${text}`);
      return found.id;
    }

    it("stores the learn-more link the player will be shown", async () => {
      const id = await idOf("طنجره");
      const updated = await updateWord(id, {
        link: "https://ar.wiktionary.org/wiki/طنجرة",
      });
      expect(updated.ok).toBe(true);
      expect(updated.ok && updated.value.link).toContain("wiktionary.org");

      // Read back through a fresh query, so this is really persisted.
      expect((await getWordByText("طنجره"))?.link).toContain("wiktionary.org");
    });

    it("refuses a link that would be unsafe in an href", async () => {
      const updated = await updateWord(await idOf("طنجره"), {
        link: "javascript:alert(1)",
      });
      expect(updated.ok && updated.value.link).toBeNull();
    });

    it("clears the link when given an empty value", async () => {
      const updated = await updateWord(await idOf("طنجره"), { link: "" });
      expect(updated.ok && updated.value.link).toBeNull();
    });

    it("keeps a note private to the operator", async () => {
      const updated = await updateWord(await idOf("طنجره"), { notes: "مثال جيد" });
      expect(updated.ok && updated.value.notes).toBe("مثال جيد");
    });
  });

  describe("phased bulk loading", () => {
    it("applies the phase defaults to rows that do not state their own flags", async () => {
      await importWords("سلحفه\nفراشه", { dialect: true, pool: true });
      await expect(getWordByText("سلحفه")).resolves.toMatchObject({
        dialect: true,
        pool: true,
      });
    });

    it("lets a row override the phase defaults", async () => {
      await importWords(JSON.stringify([{ text: "مروحه", dialect: false }]), {
        dialect: true,
        pool: true,
      });
      await expect(getWordByText("مروحه")).resolves.toMatchObject({
        dialect: false,
        pool: false,
      });
    });

    it("defaults a general-Arabic phase to words that are not eligible", async () => {
      await importWords("شجيره", { dialect: false });
      await expect(getWordByText("شجيره")).resolves.toMatchObject({
        dialect: false,
        pool: false,
      });
    });
  });

  describe("bulk flag editing", () => {
    it("marks a whole selection as dialect", async () => {
      // Pick from whatever is currently unmarked, so the test does not depend on
      // which fixtures earlier cases happened to touch.
      const candidates = await listWords({ dialect: false, pageSize: 2 });
      expect(candidates.items).toHaveLength(2);

      const result = await bulkUpdateWords(
        candidates.items.map((word) => word.id),
        { dialect: true },
      );
      expect(result.modified).toBe(2);
      await expect(getWordByText(candidates.items[0].text)).resolves.toMatchObject({
        dialect: true,
      });
    });

    it("unmarking dialect also removes the word from the pool", async () => {
      await importWords("حلاوه", { dialect: true, pool: true });
      const word = await getWordByText("حلاوه");
      expect(word).toMatchObject({ dialect: true, pool: true });

      await bulkUpdateWords([word!.id], { dialect: false });
      await expect(getWordByText("حلاوه")).resolves.toMatchObject({
        dialect: false,
        pool: false,
      });
    });

    it("adding to the pool implies the dialect flag", async () => {
      await importWords("كبريه", { dialect: false, pool: false });
      const word = await getWordByText("كبريه");
      expect(word?.dialect).toBe(false);

      await bulkUpdateWords([word!.id], { pool: true });
      const after = await getWordByText("كبريه");
      expect(after).toMatchObject({ dialect: true, pool: true });
    });
  });

  describe("previously used words", () => {
    it("lists every word that has already had its day, once each", async () => {
      const used = await listUsedWords({ pageSize: 50 });

      expect(used.total).toBeGreaterThan(0);
      const texts = used.items.map((word) => word.wordText);
      expect(new Set(texts).size).toBe(texts.length);
      for (const word of used.items) {
        expect(word.firstDateKey <= word.lastDateKey).toBe(true);
        expect(["admin", "auto", "mixed"]).toContain(word.source);
      }
    });

    it("collapses a word served twice into one row with a count", async () => {
      // زيتون was pinned for today; pin the same word again for tomorrow.
      await expect(
        setDayWord(tomorrow, "زيتون", { allowNonDialect: true, allowRepeat: true }),
      ).resolves.toMatchObject({ ok: true });

      const used = await listUsedWords({ pageSize: 100 });
      expect(used.items.find((word) => word.wordText === "زيتون")).toMatchObject({
        times: 2,
        firstDateKey: today,
        lastDateKey: tomorrow,
        source: "admin",
      });
    });

    it("refuses a repeat until the operator confirms it", async () => {
      // Release the booking made above, so this exercises the repeat guard
      // rather than the separate "already booked for another day" guard.
      await clearDayWord(tomorrow);

      const refusal = await setDayWord(addDays(today, 2), "زيتون", { allowNonDialect: true });
      expect(refusal).toMatchObject({ ok: false, code: "already-used" });
    });

    it("leaves the day untouched when a repeat is refused", async () => {
      const target = addDays(today, 3);
      await expect(resolveDay(target)).resolves.toMatchObject({ status: "pending" });

      const refusal = await setDayWord(target, "زيتون", { allowNonDialect: true });
      expect(refusal).toMatchObject({ ok: false, code: "already-used" });

      // The guard runs before any write, so nothing was rescheduled.
      await expect(resolveDay(target)).resolves.toMatchObject({ status: "pending" });
      await expect(getWordByText("زيتون")).resolves.not.toMatchObject({
        assignedDateKey: target,
      });
    });

    it("serves the repeat once the operator confirms", async () => {
      const target = addDays(today, 4);
      await expect(
        setDayWord(target, "زيتون", { allowNonDialect: true, allowRepeat: true }),
      ).resolves.toMatchObject({ ok: true });
      await expect(resolveDay(target)).resolves.toMatchObject({
        status: "ready",
        day: { wordText: "زيتون", source: "admin" },
      });
    });
  });
});
