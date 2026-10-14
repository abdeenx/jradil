/**
 * The tick that sends the daily notification.
 *
 * A timer inside the server rather than an external cron: the app deploys as
 * one long-lived container, and the send is idempotent and catches up by
 * itself, so nothing outside the app has to be scheduled.
 *
 * It checks every minute rather than sleeping until the send time. A check
 * costs a cached settings read, and it means a restart, a clock change or a
 * paused container still sends the day's notification — one long `setTimeout`
 * would silently miss the day in each of those cases. Several containers are
 * fine too: the day is claimed in the database before anything is sent.
 */

import { definePlugin } from "nitro";

const TICK_MS = 60_000;

const globalForTick = globalThis as unknown as { __jradilNotifyTick?: NodeJS.Timeout };

export default definePlugin(() => {
  // Development reloads plugins; one timer per process is enough.
  if (globalForTick.__jradilNotifyTick) clearInterval(globalForTick.__jradilNotifyTick);

  let lastError: string | null = null;

  const tick = async () => {
    try {
      const { runDailyNotification } = await import("#/lib/push.ts");
      const run = await runDailyNotification();
      lastError = null;
      if (run.status === "sent") {
        console.log(
          `[jradil] تنبيه ${run.dateKey}: وصل ${run.delivered}، تعذّر ${run.failed}، حُذف ${run.removed}`,
        );
      }
    } catch (error) {
      // Never fatal: the next tick tries again. Logged once per distinct
      // failure, so a database outage does not print a line a minute.
      const message = String((error as Error)?.message ?? error);
      if (message !== lastError) console.warn("[jradil] تعذّر فحص التنبيه اليومي:", error);
      lastError = message;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  // The tick alone should not keep the process alive.
  timer.unref();
  globalForTick.__jradilNotifyTick = timer;

  // A server that comes up inside the send window sends now, not a minute later.
  setTimeout(() => void tick(), 5_000).unref();
});
