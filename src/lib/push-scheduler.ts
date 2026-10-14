/**
 * The tick that sends the daily reminder.
 *
 * Why a timer in the server process rather than an external cron: this deploys
 * as one long-lived Node container, and the send is idempotent and catches up on
 * its own, so nothing has to be scheduled outside the app.
 *
 * The tick checks rather than sleeps-until. Waking every minute costs one indexed
 * read and means the reminder still goes out after a restart, a clock change or a
 * container that was paused at 15:00 — a single long `setTimeout` would silently
 * miss the day in every one of those cases.
 */

import "@tanstack/react-start/server-only";

import { createServerOnlyFn } from "@tanstack/react-start";

/** How often to ask whether the reminder is due. */
const TICK_MS = 60_000;

type SchedulerState = { timer: NodeJS.Timeout | null };

const globalForScheduler = globalThis as unknown as { __jradilReminder?: SchedulerState };

/**
 * Starts the tick, once per process.
 *
 * Nothing runs during a build or in the browser: `createServerOnlyFn` keeps this
 * out of client bundles, and the scheduler is only started from the server entry.
 */
export const startReminderScheduler = createServerOnlyFn(() => {
  const state: SchedulerState = (globalForScheduler.__jradilReminder ??= { timer: null });
  if (state.timer) return;

  // Imported lazily so nothing here is pulled into a client bundle, and so the
  // scheduler can be started without waiting on a database connection.
  const tick = async () => {
    try {
      const { runReminder } = await import("./push.ts");
      const result = await runReminder();
      if (result.sent) {
        console.log(
          `[jradil] daily reminder for ${result.dateKey}: ${result.delivered} delivered, ${result.pruned} pruned`,
        );
      }
    } catch (error) {
      // A failure here must never take the server down; the next tick retries.
      console.warn("[jradil] daily reminder tick failed:", error);
    }
  };

  state.timer = setInterval(() => void tick(), TICK_MS);
  // Do not hold the process open just for the reminder.
  state.timer.unref?.();

  // Catch up immediately: a restart after 15:00 should still send today's.
  void tick();

  console.log(`[jradil] reminder scheduler started, checking every ${TICK_MS / 1000}s`);
});
