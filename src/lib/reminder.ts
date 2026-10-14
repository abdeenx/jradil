/**
 * When the daily reminder goes out, and what it says.
 *
 * Pure and separate from the sending, so the timing and the wording can be
 * checked without a server, a database or a browser.
 */

import { WORDMARK_AR } from "./config.ts";
import { dayStartUtc, toSudan, sudanDateKey, type DateKey } from "./sudan-time.ts";

/** A Sudan-local clock reading: when the reminder should go out. */
export type ReminderTime = { hour: number; minute: number };

/**
 * 15:00 in Khartoum — mid-afternoon, after the new word has been live since
 * midnight, so anyone who has not played yet still has the evening.
 *
 * The operator can change it from the dashboard; this is what a deployment uses
 * until they do.
 */
export const DEFAULT_REMINDER_TIME: ReminderTime = { hour: 15, minute: 0 };

function minutesIntoDay(time: ReminderTime): number {
  return time.hour * 60 + time.minute;
}

/** Clamps whatever arrived from a settings document to a real clock reading. */
export function normalizeReminderTime(hour: unknown, minute: unknown): ReminderTime {
  // Numbers only. `Number(null)` is 0 and `Number("")` is 0, so coercing would
  // quietly turn a missing value into midnight instead of the default.
  const valid = (value: unknown, max: number, fallback: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
      ? value
      : fallback;

  return {
    hour: valid(hour, 23, DEFAULT_REMINDER_TIME.hour),
    minute: valid(minute, 59, DEFAULT_REMINDER_TIME.minute),
  };
}

/** `15:00`, which is also the format a time input reads and writes. */
export function formatReminderTime(time: ReminderTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** Reads what a time input produced, or null if it is not a clock reading. */
export function parseReminderTime(value: string): ReminderTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** The Sudan-local clock reading for an instant. */
export function reminderClock(date: Date): { hour: number; minute: number } {
  const local = toSudan(date);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/**
 * Whether the reminder for the day containing `now` is due.
 *
 * True for the whole of the rest of the Sudan day, not just the minute it fires.
 * That is what lets a server which was down at the send time still send that
 * day's reminder when it comes back, rather than losing the day.
 */
export function reminderDue(now: Date, time: ReminderTime = DEFAULT_REMINDER_TIME): boolean {
  const { hour, minute } = reminderClock(now);
  return hour * 60 + minute >= minutesIntoDay(time);
}

/** The instant the reminder is due on a given Sudan day. */
export function reminderInstant(
  dateKey: DateKey,
  time: ReminderTime = DEFAULT_REMINDER_TIME,
): Date {
  return new Date(dayStartUtc(dateKey).getTime() + minutesIntoDay(time) * 60_000);
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

/**
 * Whether to interrupt with the opt-in popup right now.
 *
 * The moment that works is just after a game ends: the player has had the thing
 * being offered, the word they would be reminded about is tomorrow's, and the
 * ask reads as "come back" rather than as an ad. Two things must not be true as
 * well — the word is still in play, or the result panel is still open, because a
 * second dialog landing on top of that one is a stack, not a prompt.
 *
 * Pure so the rule can be checked without a browser: the parts that vary are all
 * arguments.
 */
export function shouldOfferReminder(now: {
  /** The browser can ask and has not been asked. */
  available: boolean;
  dismissed: boolean;
  gameFinished: boolean;
  resultOpen: boolean;
}): boolean {
  return now.available && !now.dismissed && now.gameFinished && !now.resultOpen;
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
