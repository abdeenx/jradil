/**
 * The daily notification against a live MongoDB, with the push services
 * replaced by a stand-in that records what it was asked to send.
 *
 * Skipped without `MONGODB_URI`; otherwise runs in its own scratch database,
 * dropped afterwards, like `words.integration.test.ts`.
 */

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { connectDb, ensureSchema } from "./db.ts";
import { loadEnv } from "./env.ts";
import { SETTINGS_KEY, Settings, Subscription } from "./jradil-model.ts";
import { DEFAULT_NOTIFY_TITLE } from "./notifications.ts";
import {
  broadcastNotification,
  countSubscriptions,
  lastBroadcast,
  lastDailyRun,
  pushPublicKey,
  resetDailyNotificationState,
  runDailyNotification,
  saveSubscription,
  sendTestNotification,
  type PushSender,
  type PushTarget,
} from "./push.ts";
import { dayStartUtc, sudanDateKey } from "./sudan-time.ts";
import { importWords } from "./word-import.ts";
import { getSettings, updateSettings } from "./words.ts";

loadEnv();

const connectionString = process.env.MONGODB_URI;
const scratchDatabase = `jradil_push_test_${Date.now()}`;

const today = sudanDateKey();
/** Today at a Sudan wall-clock time. */
function todayAt(hour: number, minute = 0): Date {
  return new Date(dayStartUtc(today).getTime() + (hour * 60 + minute) * 60_000);
}

function target(id: string): PushTarget {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
  };
}

/** A push service that refuses some endpoints with a given status. */
function stubSender(refuse: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: unknown; ttl: number; topic?: string }[] = [];
  const send: PushSender = async (to, payload, options) => {
    const id = to.endpoint.split("/").pop() ?? "";
    if (id in refuse) throw Object.assign(new Error("refused"), { statusCode: refuse[id] });
    sent.push({
      endpoint: to.endpoint,
      payload: JSON.parse(payload),
      ttl: options.TTL,
      topic: options.topic,
    });
  };
  return { send, sent };
}

/** Lets the same day be sent again, as if it were a new one. */
async function forgetToday() {
  resetDailyNotificationState();
  await Settings.updateOne(
    { key: SETTINGS_KEY },
    { $set: { "notifications.lastSentDateKey": null } },
  );
}

describe.skipIf(!connectionString)("push notifications against a live MongoDB", () => {
  beforeAll(async () => {
    process.env.MONGODB_DB = scratchDatabase;
    await connectDb();
    await ensureSchema();
    // A pool to draw today's word from: the send refuses to announce no word.
    await importWords(["طنجره,1,1", "بابور,1,1", "عربيه,1,1"].join("\n"));
  }, 30_000);

  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Subscription.deleteMany({});
    await forgetToday();
  });

  describe("settings", () => {
    it("defaults to on, at 09:00, with the built-in wording", async () => {
      const { notifications } = await getSettings();
      expect(notifications).toEqual({
        enabled: true,
        time: { hour: 9, minute: 0 },
        title: null,
        body: null,
      });
    });

    it("changes one field without disturbing the rest", async () => {
      await updateSettings({
        notifications: { title: "  عنوان  ", time: { hour: 7, minute: 15 } },
      });
      await updateSettings({ notifications: { enabled: false } });
      expect((await getSettings()).notifications).toEqual({
        enabled: false,
        time: { hour: 7, minute: 15 },
        title: "عنوان",
        body: null,
      });

      // Blank wording means "back to the default".
      await updateSettings({
        notifications: { enabled: true, title: "", time: { hour: 9, minute: 0 } },
      });
      expect((await getSettings()).notifications.title).toBeNull();
    });

    it("leaves the other settings alone", async () => {
      await updateSettings({ notifications: { enabled: true } });
      expect(await getSettings()).toMatchObject({ poolSize: 30, enforceDictionary: true });
    });
  });

  describe("subscriptions", () => {
    it("generates one key pair, once, and keeps it", async () => {
      const key = await pushPublicKey();
      expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/);
      expect(await pushPublicKey()).toBe(key);
      const stored = await Settings.findOne({ key: SETTINGS_KEY }).lean();
      expect(stored?.vapidPublicKey).toBe(key);
      expect(stored?.vapidPrivateKey).toBeTruthy();
    });

    it("stores a real subscription and hands back the key", async () => {
      const result = await saveSubscription(target("a"));
      expect(result).toEqual({ ok: true, publicKey: await pushPublicKey() });
      expect(await countSubscriptions()).toBe(1);
    });

    it("refuses endpoints outside the push services, and malformed keys", async () => {
      await expect(
        saveSubscription({ ...target("a"), endpoint: "https://169.254.169.254/latest" }),
      ).resolves.toEqual({ ok: false, reason: "bad-endpoint" });
      await expect(
        saveSubscription({ ...target("a"), keys: { p256dh: "x", auth: "y" } }),
      ).resolves.toEqual({ ok: false, reason: "bad-keys" });
      expect(await countSubscriptions()).toBe(0);
    });

    it("refreshes rather than duplicates, and forgives past failures", async () => {
      await saveSubscription(target("a"));
      await Subscription.updateOne({ endpoint: target("a").endpoint }, { $set: { failures: 3 } });
      await saveSubscription(target("a"));
      const rows = await Subscription.find({}).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].failures).toBe(0);
    });
  });

  describe("the daily send", () => {
    it("waits for the send time", async () => {
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();
      await expect(runDailyNotification(todayAt(8, 59), send)).resolves.toMatchObject({
        status: "not-due",
      });
      expect(sent).toHaveLength(0);
    });

    it("sends once to everyone, then reports it already went", async () => {
      await saveSubscription(target("a"));
      await saveSubscription(target("b"));
      const { send, sent } = stubSender();

      const run = await runDailyNotification(todayAt(9, 1), send);
      expect(run).toEqual({ status: "sent", dateKey: today, delivered: 2, failed: 0, removed: 0 });
      expect(sent.map((entry) => entry.endpoint).sort()).toEqual(
        [target("a").endpoint, target("b").endpoint].sort(),
      );
      expect(sent[0].payload).toMatchObject({ title: DEFAULT_NOTIFY_TITLE, url: "/" });
      // Expires at midnight: 15 hours less a minute after 09:01.
      expect(sent[0].ttl).toBe((15 * 60 - 1) * 60);

      await expect(runDailyNotification(todayAt(9, 2), send)).resolves.toMatchObject({
        status: "already-sent",
      });
      expect(sent).toHaveLength(2);

      await expect(lastDailyRun()).resolves.toMatchObject({
        dateKey: today,
        delivered: 2,
        failed: 0,
        removed: 0,
      });
    });

    it("cannot be sent twice by two callers racing for the same day", async () => {
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();
      const runs = await Promise.all([
        runDailyNotification(todayAt(9, 1), send),
        // A second instance: it has its own memory, so only the database claim stops it.
        (async () => {
          resetDailyNotificationState();
          return runDailyNotification(todayAt(9, 1), send);
        })(),
      ]);
      expect(runs.map((run) => run.status).sort()).toEqual(["already-sent", "sent"]);
      expect(sent).toHaveLength(1);
    });

    it("sends the operator's wording", async () => {
      await updateSettings({ notifications: { title: "صباح الخير", body: "الكلمة جاهزة" } });
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();
      await runDailyNotification(todayAt(9, 1), send);
      expect(sent[0].payload).toMatchObject({ title: "صباح الخير", body: "الكلمة جاهزة" });
      await updateSettings({ notifications: { title: null, body: null } });
    });

    it("does nothing while switched off", async () => {
      await updateSettings({ notifications: { enabled: false } });
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();
      await expect(runDailyNotification(todayAt(9, 1), send)).resolves.toMatchObject({
        status: "disabled",
      });
      expect(sent).toHaveLength(0);
      await updateSettings({ notifications: { enabled: true } });
    });

    it("deletes an endpoint that is gone, and keeps one that merely failed", async () => {
      for (const id of ["ok", "gone", "flaky"]) await saveSubscription(target(id));
      const { send } = stubSender({ gone: 410, flaky: 503 });

      const run = await runDailyNotification(todayAt(9, 1), send);
      expect(run).toMatchObject({ status: "sent", delivered: 1, failed: 1, removed: 1 });

      const rows = await Subscription.find({}).lean();
      expect(rows.map((row) => row.endpoint).sort()).toEqual(
        [target("flaky").endpoint, target("ok").endpoint].sort(),
      );
      expect(rows.find((row) => row.endpoint === target("flaky").endpoint)?.failures).toBe(1);
    });

    it("drops a subscription after five refusals in a row, and forgives a success", async () => {
      await saveSubscription(target("flaky"));
      const failing = stubSender({ flaky: 500 });

      for (let day = 1; day <= 4; day += 1) {
        await runDailyNotification(todayAt(9, 1), failing.send);
        await forgetToday();
      }
      expect((await Subscription.findOne({}).lean())?.failures).toBe(4);

      // One good day resets the count.
      await runDailyNotification(todayAt(9, 1), stubSender().send);
      await forgetToday();
      expect((await Subscription.findOne({}).lean())?.failures).toBe(0);

      for (let day = 1; day <= 5; day += 1) {
        await runDailyNotification(todayAt(9, 1), failing.send);
        await forgetToday();
      }
      expect(await countSubscriptions()).toBe(0);
    });
  });

  describe("the operator's test send", () => {
    it("reaches only the given subscription", async () => {
      await saveSubscription(target("admin"));
      await saveSubscription(target("player"));
      const { send, sent } = stubSender();

      await expect(
        sendTestNotification(
          target("admin").endpoint,
          { title: "تجربة", body: null },
          new Date(),
          send,
        ),
      ).resolves.toEqual({ ok: true });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        endpoint: target("admin").endpoint,
        payload: { title: "تجربة", tag: "jradil-test" },
      });
    });

    it("refuses an endpoint the server does not hold", async () => {
      const { send, sent } = stubSender();
      await expect(
        sendTestNotification(
          target("stranger").endpoint,
          { title: null, body: null },
          new Date(),
          send,
        ),
      ).resolves.toMatchObject({ ok: false, reason: "not-subscribed" });
      expect(sent).toHaveLength(0);
    });

    it("deletes a subscription the push service says is gone", async () => {
      await saveSubscription(target("admin"));
      const { send } = stubSender({ admin: 410 });
      await expect(
        sendTestNotification(
          target("admin").endpoint,
          { title: null, body: null },
          new Date(),
          send,
        ),
      ).resolves.toMatchObject({ ok: false, reason: "gone" });
      expect(await countSubscriptions()).toBe(0);
    });
  });

  describe("the operator's send-now", () => {
    const message = { title: "خبر", body: "كلمات جديدة في القاموس" };

    beforeEach(async () => {
      await Settings.updateOne(
        { key: SETTINGS_KEY },
        { $set: { "notifications.broadcastLockedUntil": null } },
      );
    });

    it("refuses when nobody is subscribed, without holding the lock", async () => {
      const { send, sent } = stubSender();
      await expect(broadcastNotification(message, new Date(), send)).resolves.toEqual({
        ok: false,
        reason: "no-subscribers",
      });
      expect(sent).toHaveLength(0);
      const settings = await Settings.findOne({ key: SETTINGS_KEY }).lean();
      expect(settings?.notifications?.broadcastLockedUntil ?? null).toBeNull();
    });

    it("reaches everyone with the operator's words, each under its own tag", async () => {
      await saveSubscription(target("a"));
      await saveSubscription(target("b"));
      const { send, sent } = stubSender();
      const now = new Date();

      await expect(broadcastNotification(message, now, send)).resolves.toEqual({
        ok: true,
        delivered: 2,
        failed: 0,
        removed: 0,
      });
      expect(sent).toHaveLength(2);
      expect(sent[0].payload).toEqual({
        ...message,
        url: "/",
        tag: `jradil-broadcast-${now.getTime()}`,
      });
      // No topic: a push service must not fold one manual message into another.
      expect(sent[0].topic).toBeUndefined();
      expect(sent[0].ttl).toBe(12 * 60 * 60);

      await expect(lastBroadcast()).resolves.toMatchObject({ ...message, delivered: 2 });
    });

    it("refuses a second send straight after, then allows it once the minute is up", async () => {
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();

      await broadcastNotification(message, new Date(), send);
      const again = await broadcastNotification(message, new Date(), send);
      expect(again).toMatchObject({ ok: false, reason: "busy" });
      expect(sent).toHaveLength(1);

      const later = new Date(Date.now() + 61_000);
      await expect(broadcastNotification(message, later, send)).resolves.toMatchObject({
        ok: true,
      });
      expect(sent).toHaveLength(2);
    });

    it("sends once when two clicks race", async () => {
      await saveSubscription(target("a"));
      const { send, sent } = stubSender();
      const results = await Promise.all([
        broadcastNotification(message, new Date(), send),
        broadcastNotification(message, new Date(), send),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("goes out while the daily notification is off, and leaves the daily send alone", async () => {
      await saveSubscription(target("a"));
      await updateSettings({ notifications: { enabled: false } });
      const { send, sent } = stubSender();

      await expect(broadcastNotification(message, new Date(), send)).resolves.toMatchObject({
        ok: true,
      });
      await updateSettings({ notifications: { enabled: true } });
      await expect(runDailyNotification(todayAt(9, 1), send)).resolves.toMatchObject({
        status: "sent",
      });
      expect(sent).toHaveLength(2);
    });

    it("prunes dead subscriptions the same way the daily send does", async () => {
      await saveSubscription(target("ok"));
      await saveSubscription(target("gone"));
      const { send } = stubSender({ gone: 410 });
      await expect(broadcastNotification(message, new Date(), send)).resolves.toMatchObject({
        ok: true,
        delivered: 1,
        removed: 1,
      });
      expect(await countSubscriptions()).toBe(1);
    });
  });
});
