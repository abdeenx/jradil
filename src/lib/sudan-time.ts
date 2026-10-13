/**
 * Time helpers for the app's clock, which is Sudan time (UTC+2).
 *
 * Sudan has been on a fixed +02:00 offset with no daylight saving since 2017,
 * so a plain offset is exact and no timezone database is required.
 *
 * A "date key" is the Sudan-local calendar day written as `YYYY-MM-DD`. It is
 * the identity of a single day's puzzle, and the value stored on documents, so
 * it is always ASCII digits and never depends on the host machine's timezone.
 */

import { SUDAN_UTC_OFFSET_MINUTES } from "./config.ts";

export type DateKey = string;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_MS = SUDAN_UTC_OFFSET_MINUTES * 60_000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Shifts an instant so that UTC getters read as Sudan-local getters. */
export function toSudan(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** The Sudan-local calendar day for an instant. */
export function sudanDateKey(date: Date = new Date()): DateKey {
  const shifted = toSudan(date);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Validates a `YYYY-MM-DD` key, rejecting impossible dates such as 2026-02-30. */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function partsOf(key: DateKey): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  return [year, month, day];
}

/** Moves a date key by a whole number of days. */
export function addDays(key: DateKey, days: number): DateKey {
  const [year, month, day] = partsOf(key);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** The instant at which the given Sudan day begins (its 00:00). */
export function dayStartUtc(key: DateKey): Date {
  const [year, month, day] = partsOf(key);
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

/** The instant at which the given Sudan day ends (the next day's 00:00). */
export function dayEndUtc(key: DateKey): Date {
  return dayStartUtc(addDays(key, 1));
}

/** Milliseconds until the next Sudan midnight, i.e. until the next puzzle. */
export function msUntilNextSudanMidnight(now: Date = new Date()): number {
  return Math.max(0, dayEndUtc(sudanDateKey(now)).getTime() - now.getTime());
}

/**
 * Formats an instant in Sudan local time using Arabic month names.
 *
 * Latin digits (`nu-latn`) are used deliberately so that dates shown in the UI
 * match the ASCII date keys the operator sees and types.
 */
export function formatSudan(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "full" },
): string {
  return new Intl.DateTimeFormat("ar-u-nu-latn", { ...options, timeZone: "UTC" }).format(
    toSudan(date),
  );
}

/** Formats a Sudan date key such as `2026-10-13` for display. */
export function formatDateKey(
  key: DateKey,
  options: Intl.DateTimeFormatOptions = { dateStyle: "full" },
): string {
  return formatSudan(dayStartUtc(key), options);
}

/** Short label for a date key, e.g. `الثلاثاء 13 أكتوبر 2026`. */
export function shortDateKey(key: DateKey): string {
  return formatDateKey(key, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * Breaks a millisecond duration into clock parts, for the countdown display.
 */
export function splitDuration(ms: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Two-digit Latin clock parts, e.g. `07:04:09`. */
export function formatDuration(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}
