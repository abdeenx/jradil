/**
 * When the daily reminder goes out, and what it says.
 *
 * Pure and separate from the sending, so the timing and the wording can be
 * checked without a server, a database or a browser.
 */

import { WORDMARK_AR } from "./config.ts";
import { dayStartUtc, toSudan, sudanDateKey, type DateKey } from "./sudan-time.ts";

/**
 * The reminder fires at 15:00 in Khartoum — mid-afternoon, after the new word has
 * been live since midnight, so anyone who has not played yet still has the
 * evening.
 */
export const REMINDER_HOUR = 15;
export const REMINDER_MINUTE = 0;

const REMINDER_MINUTES_INTO_DAY = REMINDER_HOUR * 60 + REMINDER_MINUTE;

/** The Sudan-local clock reading for an instant. */
export function reminderClock(date: Date): { hour: number; minute: number } {
  const local = toSudan(date);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/**
 * Whether the reminder for the day containing `now` is due.
 *
 * True for the whole of the rest of the Sudan day, not just the minute it fires.
 * That is what lets a server which was down at 15:00 send the reminder when it
 * comes back, instead of losing the day.
 */
export function reminderDue(now: Date): boolean {
  const { hour, minute } = reminderClock(now);
  return hour * 60 + minute >= REMINDER_MINUTES_INTO_DAY;
}

/** The instant the reminder is due on a given Sudan day. */
export function reminderInstant(dateKey: DateKey): Date {
  return new Date(dayStartUtc(dateKey).getTime() + REMINDER_MINUTES_INTO_DAY * 60_000);
}

/**
 * Decodes a base64url VAPID key into the bytes `pushManager.subscribe` wants.
 *
 * Easy to get quietly wrong: a mangled key does not throw, it simply never
 * subscribes, and the player sees a button that does nothing.
 */
export function vapidKeyBytes(base64: string): ArrayBuffer {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}

export type ReminderMessage = {
  title: string;
  body: string;
  /** Where a tap should land. */
  url: string;
  /** Collapses a repeated notification for the same day instead of stacking. */
  tag: string;
};

/**
 * The notification itself.
 *
 * Titled with the bare wordmark rather than `APP_NAME_AR`, which carries a
 * descriptor — "جرادل - لعبة كلمة اليوم" would repeat "كلمة اليوم" in the title
 * of a notification that exists to announce it. The hyphen follows the house
 * style in `config.ts`.
 *
 * `dateKey` doubles as the tag, so a reminder re-sent after a restart replaces
 * the earlier one rather than appearing twice.
 */
export function reminderMessage(now: Date, appUrl: string | null): ReminderMessage {
  const dateKey = sudanDateKey(now);
  const base = appUrl?.replace(/\/+$/, "") ?? "";

  return {
    title: `${WORDMARK_AR} - كلمة اليوم جاهزة`,
    body: "كلمة جديدة بانتظارك: خمسة حروف، ست محاولات.",
    url: base ? `${base}/` : "/",
    tag: dateKey,
  };
}
