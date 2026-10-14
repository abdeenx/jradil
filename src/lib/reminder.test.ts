import { describe, expect, it } from "vite-plus/test";

import { loadEnv } from "./env.ts";
import {
  reminderClock,
  reminderDue,
  reminderInstant,
  reminderMessage,
  vapidKeyBytes,
} from "./reminder.ts";

/**
 * Khartoum is UTC+2 with no daylight saving, so every case here is written as an
 * explicit UTC instant: the whole point is that 15:00 local is 13:00 UTC.
 */
describe("when the reminder is due", () => {
  it("does not fire before 15:00 Khartoum", () => {
    expect(reminderDue(new Date("2026-10-14T11:59:00Z"))).toBe(false);
    expect(reminderDue(new Date("2026-10-14T12:00:00Z"))).toBe(false);
  });

  it("fires at exactly 15:00 Khartoum", () => {
    const at = new Date("2026-10-14T13:00:00Z");
    expect(reminderClock(at)).toEqual({ hour: 15, minute: 0 });
    expect(reminderDue(at)).toBe(true);
  });

  it("stays due for the rest of the Sudan day", () => {
    // Not just the minute it fires. This is what lets a server that was asleep
    // at 15:00 still send the day's reminder once it wakes.
    expect(reminderDue(new Date("2026-10-14T13:01:00Z"))).toBe(true);
    expect(reminderDue(new Date("2026-10-14T20:00:00Z"))).toBe(true);
    expect(reminderDue(new Date("2026-10-14T21:59:00Z"))).toBe(true);
  });

  it("stops being due when the Sudan day turns over", () => {
    // 22:00 UTC is midnight in Khartoum: a new day, and not yet 15:00 on it.
    expect(reminderDue(new Date("2026-10-14T22:00:00Z"))).toBe(false);
    expect(reminderDue(new Date("2026-10-14T22:30:00Z"))).toBe(false);
  });

  it("reads the local clock, not the host's", () => {
    expect(reminderClock(new Date("2026-10-14T22:00:00Z"))).toEqual({ hour: 0, minute: 0 });
    expect(reminderClock(new Date("2026-10-14T00:30:00Z"))).toEqual({ hour: 2, minute: 30 });
  });

  it("puts the instant on the right day, at the right time", () => {
    expect(reminderInstant("2026-10-14").toISOString()).toBe("2026-10-14T13:00:00.000Z");
    // Sudan has no daylight saving, so the offset is the same in July.
    expect(reminderInstant("2026-07-14").toISOString()).toBe("2026-07-14T13:00:00.000Z");
  });
});

describe("the notification", () => {
  const at = new Date("2026-10-14T13:00:00Z");

  it("announces the word of the day", () => {
    const message = reminderMessage(at, null);
    expect(message.title).toContain("كلمة اليوم");
    expect(message.title).toContain("جرادل");
  });

  it("does not say the same thing twice in the title", () => {
    // The app name carries a descriptor, so a naive title repeats the phrase the
    // notification exists to announce.
    const message = reminderMessage(at, null);
    expect(message.title.match(/كلمة اليوم/g)).toHaveLength(1);
  });

  it("opens the game when tapped", () => {
    expect(reminderMessage(at, "https://jradil.example.com").url).toBe(
      "https://jradil.example.com/",
    );
    expect(reminderMessage(at, "https://jradil.example.com/").url).toBe(
      "https://jradil.example.com/",
    );
    // Nothing configured still leaves a tappable notification.
    expect(reminderMessage(at, null).url).toBe("/");
  });

  it("tags by day, so a re-send replaces rather than stacks", () => {
    expect(reminderMessage(at, null).tag).toBe("2026-10-14");
    expect(reminderMessage(new Date("2026-10-15T13:00:00Z"), null).tag).toBe("2026-10-15");
  });
});

describe("the VAPID key the browser is given", () => {
  it("round-trips a 65-byte P-256 point", () => {
    // An uncompressed P-256 public key: 65 bytes, starting with 0x04. If the
    // decoding is wrong, `subscribe()` fails silently and the player is left
    // with a button that does nothing.
    const point = new Uint8Array(65);
    point[0] = 0x04;
    for (let index = 1; index < point.length; index += 1) point[index] = index;

    const base64url = btoa(String.fromCharCode(...point))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(new Uint8Array(vapidKeyBytes(base64url))).toEqual(point);
  });

  it("handles the base64url alphabet and stripped padding", () => {
    expect(new Uint8Array(vapidKeyBytes("-_8"))).toEqual(new Uint8Array([0xfb, 0xff]));
    expect(new Uint8Array(vapidKeyBytes("QQ"))).toEqual(new Uint8Array([0x41]));
  });

  it("decodes this deployment's key into a usable point", () => {
    // The real key, when one is configured. Catches a truncated or mangled
    // value in `.env`, which is otherwise only discovered by a player whose
    // reminder never arrives.
    loadEnv();
    const configured = process.env.VAPID_PUBLIC_KEY;
    if (!configured) return;

    const bytes = new Uint8Array(vapidKeyBytes(configured));
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });
});
