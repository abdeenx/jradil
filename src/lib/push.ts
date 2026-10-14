/**
 * Web push: the key pair, the subscriptions, and delivering the daily
 * notification.
 *
 * Server-only — it holds the VAPID private key and calls the push services
 * directly.
 *
 * Delivery is forgiving on purpose. An endpoint that answers 404 or 410 is gone
 * for good and is deleted at once; any other refusal counts as a failure, and a
 * subscription is only dropped after several in a row, because a push service
 * having a bad day should not unsubscribe a player who never asked to leave.
 */

import "@tanstack/react-start/server-only";

import webpush from "web-push";

import { ensureSchema } from "./db.ts";
import { optionalEnv } from "./env.ts";
import { SETTINGS_KEY, Settings, Subscription } from "./jradil-model.ts";
import {
  AUTH_PATTERN,
  P256DH_PATTERN,
  isPushEndpoint,
  notificationDue,
  notificationMessage,
  notificationTtlSeconds,
  type NotificationMessage,
} from "./notifications.ts";
import { sudanDateKey, type DateKey } from "./sudan-time.ts";
import { getSettings, resolveDay } from "./words.ts";

/** Consecutive refusals before a subscription is treated as abandoned. */
const MAX_FAILURES = 5;

/** Requests in flight at once while sending to everyone. */
const CONCURRENCY = 20;

/**
 * A ceiling on stored subscriptions. Subscribing needs no account, so without
 * one a script could fill the database with endpoints that will never answer.
 */
const MAX_SUBSCRIPTIONS = 100_000;

export type PushKeys = { p256dh: string; auth: string };
export type PushTarget = { endpoint: string; keys: PushKeys };

// ------------------------------------------------------------------ keys --

type VapidKeys = { publicKey: string; privateKey: string };

let vapidKeys: Promise<VapidKeys> | null = null;

/**
 * The VAPID key pair, kept in the settings document like the progress secret:
 * every instance shares it and a deployment needs no configuration. The first
 * caller generates it; the conditional write means a concurrent caller cannot
 * replace it, and both read back the pair that won.
 */
function getVapidKeys(): Promise<VapidKeys> {
  vapidKeys ??= (async () => {
    await getSettings();
    const generated = webpush.generateVAPIDKeys();
    await Settings.updateOne(
      { key: SETTINGS_KEY, vapidPrivateKey: null },
      { $set: { vapidPublicKey: generated.publicKey, vapidPrivateKey: generated.privateKey } },
    );
    const stored = await Settings.findOne(
      { key: SETTINGS_KEY },
      { vapidPublicKey: 1, vapidPrivateKey: 1 },
    ).lean();
    if (!stored?.vapidPublicKey || !stored.vapidPrivateKey) {
      throw new Error("تعذّر إنشاء مفاتيح التنبيهات");
    }
    return { publicKey: stored.vapidPublicKey, privateKey: stored.vapidPrivateKey };
  })().catch((error: unknown) => {
    vapidKeys = null;
    throw error;
  });
  return vapidKeys;
}

/** The half a browser needs to subscribe. Public by design. */
export async function pushPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

/**
 * Who push services should contact about this sender. The protocol requires an
 * `https:` or `mailto:` address, and Apple refuses anything else, so the site's
 * own address is used when it is https.
 */
function vapidSubject(): string {
  const explicit = optionalEnv("VAPID_SUBJECT");
  if (explicit) return explicit;
  const appUrl = optionalEnv("APP_URL");
  if (appUrl?.startsWith("https://")) return appUrl;
  return "mailto:webpush@jradil.invalid";
}

// --------------------------------------------------------- subscriptions --

export type SubscribeResult = { ok: true; publicKey: string } | { ok: false; reason: string };

/**
 * Saves a subscription, or refreshes one the browser handed over before.
 *
 * An upsert, because a browser re-sends the same endpoint; resetting `failures`
 * matters, since a resubscribe is a player saying they still want it. The
 * public key comes back so the browser can tell whether it subscribed against
 * the key the server signs with now.
 */
export async function saveSubscription(input: PushTarget): Promise<SubscribeResult> {
  if (!isPushEndpoint(input.endpoint)) return { ok: false, reason: "bad-endpoint" };
  if (!P256DH_PATTERN.test(input.keys.p256dh) || !AUTH_PATTERN.test(input.keys.auth)) {
    return { ok: false, reason: "bad-keys" };
  }

  await ensureSchema();

  const known = await Subscription.exists({ endpoint: input.endpoint });
  // `$gt: ""` keeps this a count over the endpoint index rather than a scan.
  if (
    !known &&
    (await Subscription.countDocuments({ endpoint: { $gt: "" } })) >= MAX_SUBSCRIPTIONS
  ) {
    return { ok: false, reason: "full" };
  }

  await Subscription.updateOne(
    { endpoint: input.endpoint },
    { $set: { keys: input.keys, failures: 0 } },
    { upsert: true },
  );
  return { ok: true, publicKey: await pushPublicKey() };
}

/** Forgets a subscription, when a player turns the notification off. */
export async function removeSubscription(endpoint: string): Promise<void> {
  await ensureSchema();
  await Subscription.deleteOne({ endpoint });
}

export async function countSubscriptions(): Promise<number> {
  await ensureSchema();
  return Subscription.countDocuments({ endpoint: { $gt: "" } });
}

// -------------------------------------------------------------- delivery --

export type SendOptions = { TTL: number; topic: string; urgency: "normal" };

/**
 * Sends one push. Throws on refusal, with the push service's `statusCode` when
 * there was one. Swappable so the tests can stand in for the push services.
 */
export type PushSender = (
  target: PushTarget,
  payload: string,
  options: SendOptions,
) => Promise<void>;

const webPushSender: PushSender = async (target, payload, options) => {
  const keys = await getVapidKeys();
  await webpush.sendNotification(target, payload, {
    ...options,
    timeout: 10_000,
    vapidDetails: { subject: vapidSubject(), ...keys },
  });
};

export type DeliveryReport = { delivered: number; failed: number; removed: number };

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}

/** `$in` lists are capped so a large send never builds one enormous query. */
function chunks<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

async function deliver(
  targets: (PushTarget & { failures?: number })[],
  message: NotificationMessage,
  options: SendOptions,
  send: PushSender,
): Promise<DeliveryReport> {
  const payload = JSON.stringify(message);
  const gone: string[] = [];
  const refused: string[] = [];
  const recovered: string[] = [];
  let delivered = 0;

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const target = targets[next++];
      try {
        await send({ endpoint: target.endpoint, keys: target.keys }, payload, options);
        delivered += 1;
        if ((target.failures ?? 0) > 0) recovered.push(target.endpoint);
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) gone.push(target.endpoint);
        else refused.push(target.endpoint);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  let removed = gone.length;
  for (const batch of chunks(gone)) await Subscription.deleteMany({ endpoint: { $in: batch } });
  for (const batch of chunks(recovered)) {
    await Subscription.updateMany({ endpoint: { $in: batch } }, { $set: { failures: 0 } });
  }
  for (const batch of chunks(refused)) {
    await Subscription.updateMany({ endpoint: { $in: batch } }, { $inc: { failures: 1 } });
    const dropped = await Subscription.deleteMany({
      endpoint: { $in: batch },
      failures: { $gte: MAX_FAILURES },
    });
    removed += dropped.deletedCount;
  }

  return { delivered, failed: refused.length, removed };
}

// ----------------------------------------------------------- daily send --

export type DailyRun =
  | { status: "disabled" | "not-due" | "no-word" | "already-sent"; dateKey: DateKey }
  | ({ status: "sent"; dateKey: DateKey } & DeliveryReport);

/** The day this process already knows is done, so the tick can skip the database. */
let settledDateKey: DateKey | null = null;

/**
 * Claims the day, atomically. Only one caller can move `lastSentDateKey` to
 * today, so two ticks — or two containers — cannot both send. The claim comes
 * before delivery: a crash mid-send loses a day's notification, which is far
 * better than a restart sending it to everyone twice.
 */
async function claimDay(dateKey: DateKey): Promise<boolean> {
  const claimed = await Settings.findOneAndUpdate(
    { key: SETTINGS_KEY, "notifications.lastSentDateKey": { $ne: dateKey } },
    { $set: { "notifications.lastSentDateKey": dateKey } },
    { projection: { _id: 1 }, lean: true },
  );
  return claimed !== null;
}

/**
 * Sends today's notification if it is due and has not gone out.
 *
 * Safe to call as often as you like — it decides for itself whether there is
 * anything to do — which is what lets a server that was down at the send time
 * still send when it comes back, within the late window.
 */
export async function runDailyNotification(
  now: Date = new Date(),
  send: PushSender = webPushSender,
): Promise<DailyRun> {
  const dateKey = sudanDateKey(now);
  if (settledDateKey === dateKey) return { status: "already-sent", dateKey };

  const { notifications } = await getSettings();
  if (!notifications.enabled) return { status: "disabled", dateKey };
  if (!notificationDue(now, notifications.time)) return { status: "not-due", dateKey };

  // Announcing a word that does not exist would send everyone to an empty
  // board. Not claimed, so a word set later in the window still goes out.
  if ((await resolveDay(dateKey)).status !== "ready") return { status: "no-word", dateKey };

  if (!(await claimDay(dateKey))) {
    settledDateKey = dateKey;
    return { status: "already-sent", dateKey };
  }
  settledDateKey = dateKey;

  const targets = await Subscription.find({}, { endpoint: 1, keys: 1, failures: 1 }).lean<
    (PushTarget & { failures: number })[]
  >();
  const report = await deliver(
    targets,
    notificationMessage(notifications, dateKey),
    { TTL: notificationTtlSeconds(now), topic: "jradil-daily", urgency: "normal" },
    send,
  );

  await Settings.updateOne(
    { key: SETTINGS_KEY },
    { $set: { "notifications.lastRun": { dateKey, at: now, ...report } } },
  );
  return { status: "sent", dateKey, ...report };
}

/** Forgets the in-memory "done for today", for tests that replay a day. */
export function resetDailyNotificationState(): void {
  settledDateKey = null;
}

export type LastRun = { dateKey: DateKey; at: string } & DeliveryReport;

/** The record of the last daily send, for the dashboard. */
export async function lastDailyRun(): Promise<LastRun | null> {
  await ensureSchema();
  const settings = await Settings.findOne(
    { key: SETTINGS_KEY },
    { "notifications.lastRun": 1 },
  ).lean<{
    notifications?: { lastRun?: (DeliveryReport & { dateKey: DateKey; at: Date }) | null };
  }>();
  const run = settings?.notifications?.lastRun;
  if (!run) return null;
  return {
    dateKey: run.dateKey,
    at: run.at.toISOString(),
    delivered: run.delivered,
    failed: run.failed,
    removed: run.removed,
  };
}

// ------------------------------------------------------------- test send --

export type TestSendResult =
  | { ok: true }
  | { ok: false; reason: "not-subscribed" | "gone" | "refused"; status: number | null };

/**
 * Sends one notification to one subscription the server already holds — the
 * operator's own browser — so the wording and the whole delivery path can be
 * checked without touching anyone else.
 */
export async function sendTestNotification(
  endpoint: string,
  text: { title: string | null; body: string | null },
  now: Date = new Date(),
  send: PushSender = webPushSender,
): Promise<TestSendResult> {
  await ensureSchema();
  const target = await Subscription.findOne(
    { endpoint },
    { endpoint: 1, keys: 1 },
  ).lean<PushTarget>();
  if (!target) return { ok: false, reason: "not-subscribed", status: null };

  const message = { ...notificationMessage(text, sudanDateKey(now)), tag: "jradil-test" };
  try {
    await send({ endpoint: target.endpoint, keys: target.keys }, JSON.stringify(message), {
      TTL: 300,
      topic: "jradil-test",
      urgency: "normal",
    });
    return { ok: true };
  } catch (error) {
    const status = statusOf(error);
    if (status === 404 || status === 410) {
      await Subscription.deleteOne({ endpoint });
      return { ok: false, reason: "gone", status };
    }
    return { ok: false, reason: "refused", status };
  }
}
