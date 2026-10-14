/**
 * The daily notification: when it goes out, what it says, and which push
 * services may receive it.
 *
 * Pure and shared by the server, the admin screen and the tests, so the rules
 * can be checked without a browser, a database or a push service.
 */

import { WORDMARK_AR } from "./config.ts";
import { dayEndUtc, sudanDateKey, toSudan, type DateKey } from "./sudan-time.ts";

/** A Sudan-local clock reading. */
export type NotifyTime = { hour: number; minute: number };

/** What the operator controls from the dashboard. */
export type NotificationSettings = {
  enabled: boolean;
  time: NotifyTime;
  /** Null means the built-in wording below. */
  title: string | null;
  body: string | null;
};

/**
 * 09:00 in Khartoum: the word has been live since midnight, nobody is woken by
 * it, and the whole day is still left to play.
 */
export const DEFAULT_NOTIFY_TIME: NotifyTime = { hour: 9, minute: 0 };

/** A plain hyphen, never an em dash, as everywhere else in the copy. */
export const DEFAULT_NOTIFY_TITLE = `${WORDMARK_AR} - كلمة اليوم جاهزة`;
export const DEFAULT_NOTIFY_BODY = "كلمة سودانية جديدة بانتظارك: خمسة حروف وست محاولات.";

/** Longer than this and a phone cuts the text off anyway. */
export const NOTIFY_TITLE_MAX = 60;
export const NOTIFY_BODY_MAX = 160;

/**
 * How late the day's notification may still go out.
 *
 * A server that was down at the send time catches up when it returns, but only
 * within this window: "today's word is ready" at midnight would be noise.
 */
export const LATE_WINDOW_MINUTES = 180;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  time: DEFAULT_NOTIFY_TIME,
  title: null,
  body: null,
};

function minutesOf(time: NotifyTime): number {
  return time.hour * 60 + time.minute;
}

/** Clamps whatever a settings document holds to a real clock reading. */
export function normalizeNotifyTime(hour: unknown, minute: unknown): NotifyTime {
  // Numbers only: `Number(null)` is 0, which would quietly mean midnight.
  const valid = (value: unknown, max: number, fallback: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
      ? value
      : fallback;
  return {
    hour: valid(hour, 23, DEFAULT_NOTIFY_TIME.hour),
    minute: valid(minute, 59, DEFAULT_NOTIFY_TIME.minute),
  };
}

/** `09:00` — also the format a time input reads and writes. */
export function formatNotifyTime(time: NotifyTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** Reads what a time input produced, or null if it is not a clock reading. */
export function parseNotifyTime(value: string): NotifyTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Trims operator copy; blank means "use the default". */
export function cleanNotifyText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

/**
 * Whether the notification for the Sudan day containing `now` should go out.
 *
 * True from the configured minute until {@link LATE_WINDOW_MINUTES} after it,
 * never before and never past midnight. Whether it already went out today is
 * the caller's business: that is recorded in the database, not derivable here.
 */
export function notificationDue(now: Date, time: NotifyTime): boolean {
  const local = toSudan(now);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const at = minutesOf(time);
  return minutes >= at && minutes < at + LATE_WINDOW_MINUTES;
}

export type NotificationMessage = {
  title: string;
  body: string;
  /** Where a tap should land. Always this site. */
  url: string;
  /** The same tag replaces rather than stacks a notification for the same day. */
  tag: string;
};

export function notificationMessage(
  settings: Pick<NotificationSettings, "title" | "body">,
  dateKey: DateKey,
): NotificationMessage {
  return {
    title: settings.title ?? DEFAULT_NOTIFY_TITLE,
    body: settings.body ?? DEFAULT_NOTIFY_BODY,
    url: "/",
    tag: `jradil-${dateKey}`,
  };
}

/**
 * How long a push service should keep trying to deliver: until the word it
 * announces is replaced. A phone that is off all day should not wake up to
 * yesterday's notification.
 */
export function notificationTtlSeconds(now: Date): number {
  const remaining = dayEndUtc(sudanDateKey(now)).getTime() - now.getTime();
  return Math.max(60, Math.floor(remaining / 1000));
}

/**
 * The push services browsers actually use.
 *
 * The server sends a request to whatever endpoint a subscription names, so an
 * unchecked endpoint would let anyone make it call an arbitrary address —
 * including ones inside the hosting network. Only these hosts are accepted.
 */
const PUSH_HOST_SUFFIXES = [
  // Chrome, Edge on Android, Samsung Internet, Opera, Brave
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox
  "push.services.mozilla.com",
  // Safari on macOS and iOS
  "push.apple.com",
  // Edge on Windows
  "notify.windows.com",
];

export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The browser's subscription keys, base64url: a P-256 point and a 16-byte secret. */
export const P256DH_PATTERN = /^[A-Za-z0-9_-]{86,88}={0,2}$/;
export const AUTH_PATTERN = /^[A-Za-z0-9_-]{22,24}={0,2}$/;

/**
 * Decodes a base64url key into the bytes `pushManager.subscribe` wants.
 *
 * Easy to get quietly wrong: a mangled key does not throw, it simply never
 * subscribes.
 */
export function base64UrlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Whether two keys, in any mix of bytes and base64url, are the same key. */
export function sameKey(a: ArrayBuffer | null | undefined, base64: string): boolean {
  if (!a) return false;
  const left = new Uint8Array(a);
  const right = base64UrlToBytes(base64);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export type ScheduleStatus = "disabled" | "sent" | "upcoming" | "sending" | "missed";

/** Where today stands, for the dashboard. */
export function scheduleStatus(
  now: Date,
  settings: Pick<NotificationSettings, "enabled" | "time">,
  lastSentDateKey: DateKey | null,
): ScheduleStatus {
  if (!settings.enabled) return "disabled";
  if (lastSentDateKey === sudanDateKey(now)) return "sent";
  if (notificationDue(now, settings.time)) return "sending";
  const local = toSudan(now);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes < minutesOf(settings.time) ? "upcoming" : "missed";
}
