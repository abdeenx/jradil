/**
 * Browser push: storing subscriptions and delivering the daily reminder.
 *
 * Server-only — it holds the VAPID private key and talks to the push services
 * directly, so none of it may reach a client.
 *
 * Delivery is deliberately forgiving. A push endpoint that answers 404 or 410 is
 * gone for good and is deleted; anything else counts as a failure and the
 * subscription is dropped only after several in a row, because transient push
 * service trouble should not unsubscribe a player who never asked to leave.
 */

import "@tanstack/react-start/server-only";

import webpush from "web-push";

import { ensureSchema } from "./db.ts";
import { optionalEnv } from "./env.ts";
import { SETTINGS_KEY, Settings, Subscription } from "./jradil-model.ts";
import { reminderDue, reminderMessage } from "./reminder.ts";
import { sudanDateKey } from "./sudan-time.ts";

/** Consecutive failures before a subscription is treated as abandoned. */
const MAX_FAILURES = 5;

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushConfig = {
  /** Base64url VAPID public key the browser needs, or null when unconfigured. */
  publicKey: string | null;
};

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = optionalEnv("VAPID_PUBLIC_KEY");
  const privateKey = optionalEnv("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    // The subject is required by the protocol; a bad one makes services reject us.
    subject: optionalEnv("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  };
}

/** Whether this deployment can send notifications at all. */
export function pushConfigured(): boolean {
  return vapid() !== null;
}

/** The key the browser needs, or null when notifications are not set up. */
export function pushPublicKey(): string | null {
  return vapid()?.publicKey ?? null;
}

/**
 * Saves a subscription, or refreshes one the browser handed us before.
 *
 * A browser can re-register the same endpoint, so this is an upsert: resetting
 * `failures` matters, because a resubscribe is a player telling us they still
 * want the reminder.
 */
export async function saveSubscription(
  input: PushSubscriptionInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureSchema();

  const endpoint = input.endpoint?.trim();
  const p256dh = input.keys?.p256dh?.trim();
  const auth = input.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: "اشتراك غير مكتمل" };
  }
  // Only real push endpoints: anything else is a client sending us rubbish.
  if (!endpoint.startsWith("https://")) {
    return { ok: false, reason: "عنوان الاشتراك غير صالح" };
  }

  await Subscription.updateOne(
    { endpoint },
    { $set: { keys: { p256dh, auth }, failures: 0 } },
    { upsert: true },
  );
  return { ok: true };
}

/** Forgets a subscription, when a player turns the reminder off. */
export async function removeSubscription(endpoint: string): Promise<{ removed: number }> {
  await ensureSchema();
  const result = await Subscription.deleteOne({ endpoint: endpoint.trim() });
  return { removed: result.deletedCount };
}

export async function countSubscriptions(): Promise<number> {
  await ensureSchema();
  return Subscription.countDocuments({});
}

export type ReminderRun = {
  /** False when the day's reminder had already gone out, or is not due yet. */
  sent: boolean;
  reason: "not-due" | "already-sent" | "not-configured" | "sent";
  /** How many subscriptions were reached. */
  delivered: number;
  /** How many endpoints turned out to be dead. */
  pruned: number;
  dateKey: string;
};

/**
 * Claims the day, atomically.
 *
 * `lastReminderDateKey` is only written if it does not already hold this day, so
 * two ticks — or two containers — cannot both decide to send. The claim happens
 * *before* delivery: a crash mid-send loses a reminder, which is much better than
 * a restart sending the whole channel a second time.
 */
async function claimDay(dateKey: string): Promise<boolean> {
  const claimed = await Settings.findOneAndUpdate(
    { key: SETTINGS_KEY, lastReminderDateKey: { $ne: dateKey } },
    { $set: { lastReminderDateKey: dateKey } },
    { returnDocument: "after", lean: true },
  );
  return claimed !== null;
}

/**
 * Sends the reminder for today, if it is due and has not gone out.
 *
 * Safe to call as often as you like: it decides for itself whether there is
 * anything to do. That is what makes it survive a server that was asleep at
 * 15:00 — the next tick after it wakes still sends.
 */
export async function runReminder(now: Date = new Date()): Promise<ReminderRun> {
  const dateKey = sudanDateKey(now);

  if (!reminderDue(now)) {
    return { sent: false, reason: "not-due", delivered: 0, pruned: 0, dateKey };
  }

  const credentials = vapid();
  if (!credentials) {
    return { sent: false, reason: "not-configured", delivered: 0, pruned: 0, dateKey };
  }

  await ensureSchema();
  if (!(await claimDay(dateKey))) {
    return { sent: false, reason: "already-sent", delivered: 0, pruned: 0, dateKey };
  }

  webpush.setVapidDetails(credentials.subject, credentials.publicKey, credentials.privateKey);

  const payload = JSON.stringify(reminderMessage(now, optionalEnv("APP_URL")));
  const subscriptions = await Subscription.find({}).lean();

  let delivered = 0;
  let pruned = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const target = subscription as unknown as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
        failures: number;
      };

      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: target.keys }, payload);
        delivered += 1;
        await Subscription.updateOne(
          { endpoint: target.endpoint },
          { $set: { lastSentAt: new Date(), failures: 0 } },
        );
      } catch (error) {
        // 404 and 410 mean the subscription is finished; anything else might be
        // the push service having a bad minute.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await Subscription.deleteOne({ endpoint: target.endpoint });
          pruned += 1;
          return;
        }

        const failures = (target.failures ?? 0) + 1;
        if (failures >= MAX_FAILURES) {
          await Subscription.deleteOne({ endpoint: target.endpoint });
          pruned += 1;
          return;
        }
        await Subscription.updateOne({ endpoint: target.endpoint }, { $set: { failures } });
      }
    }),
  );

  return { sent: true, reason: "sent", delivered, pruned, dateKey };
}
