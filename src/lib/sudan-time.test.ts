import { describe, expect, it } from "vite-plus/test";

import {
  addDays,
  dayEndUtc,
  dayStartUtc,
  formatDuration,
  isDateKey,
  msUntilNextSudanMidnight,
  sudanDateKey,
  toSudan,
} from "./sudan-time.ts";

describe("Sudan day boundaries (UTC+2)", () => {
  it("keeps the same day right up to 21:59:59 UTC", () => {
    expect(sudanDateKey(new Date("2026-10-13T00:00:00Z"))).toBe("2026-10-13");
    expect(sudanDateKey(new Date("2026-10-13T21:59:59Z"))).toBe("2026-10-13");
  });

  it("rolls over exactly at 22:00 UTC, which is Sudan midnight", () => {
    expect(sudanDateKey(new Date("2026-10-13T22:00:00Z"))).toBe("2026-10-14");
    expect(sudanDateKey(new Date("2026-10-13T22:00:01Z"))).toBe("2026-10-14");
  });

  it("shifts an instant by two hours for display", () => {
    expect(toSudan(new Date("2026-10-13T22:00:00Z")).toISOString()).toBe(
      "2026-10-14T00:00:00.000Z",
    );
  });

  it("maps a date key back onto the right UTC instants", () => {
    expect(dayStartUtc("2026-10-14").toISOString()).toBe("2026-10-13T22:00:00.000Z");
    expect(dayEndUtc("2026-10-14").toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(dayEndUtc("2026-10-14").getTime()).toBe(dayStartUtc("2026-10-15").getTime());
  });

  it("has no daylight saving transition to worry about", () => {
    // Sudan is +02:00 in January and in July.
    expect(dayStartUtc("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(dayStartUtc("2026-07-15").toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("isDateKey", () => {
  it("accepts real calendar days", () => {
    expect(isDateKey("2026-10-13")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
  });

  it("rejects malformed or impossible days", () => {
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("26-10-13")).toBe(false);
    expect(isDateKey(20261013)).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
    expect(isDateKey("2026-10-13T00:00:00Z")).toBe(false);
  });
});

describe("countdown", () => {
  it("reports the time left until Sudan midnight", () => {
    expect(msUntilNextSudanMidnight(new Date("2026-10-13T21:00:00Z"))).toBe(60 * 60 * 1000);
    expect(msUntilNextSudanMidnight(new Date("2026-10-13T22:00:00Z"))).toBe(24 * 60 * 60 * 1000);
  });

  it("never goes negative", () => {
    expect(msUntilNextSudanMidnight(new Date("2026-10-13T23:30:00Z"))).toBeGreaterThan(0);
  });

  it("formats an hh:mm:ss clock", () => {
    expect(formatDuration(3 * 3600_000 + 4 * 60_000 + 9_000)).toBe("03:04:09");
    expect(formatDuration(0)).toBe("00:00:00");
  });
});
