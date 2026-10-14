import { describe, expect, it } from "vite-plus/test";

import {
  AUTH_PATTERN,
  DEFAULT_NOTIFY_BODY,
  DEFAULT_NOTIFY_TIME,
  DEFAULT_NOTIFY_TITLE,
  LATE_WINDOW_MINUTES,
  P256DH_PATTERN,
  base64UrlToBytes,
  cleanNotifyText,
  formatNotifyTime,
  isPushEndpoint,
  normalizeNotifyTime,
  notificationDue,
  notificationMessage,
  notificationTtlSeconds,
  parseNotifyTime,
  sameKey,
  scheduleStatus,
} from "./notifications.ts";

/** A Sudan-local wall-clock time on 2026-10-14, as an instant (Sudan is UTC+2). */
function khartoum(hour: number, minute = 0, day = 14): Date {
  return new Date(Date.UTC(2026, 9, day, hour - 2, minute));
}

describe("send time", () => {
  it("round-trips through the time input format", () => {
    expect(formatNotifyTime({ hour: 9, minute: 5 })).toBe("09:05");
    expect(parseNotifyTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseNotifyTime("23:59")).toEqual({ hour: 23, minute: 59 });
  });

  it("refuses anything that is not a clock reading", () => {
    for (const value of ["24:00", "12:60", "9", "", "ab:cd", "12:5"]) {
      expect(parseNotifyTime(value)).toBeNull();
    }
  });

  it("falls back to the default for missing or impossible stored values", () => {
    expect(normalizeNotifyTime(undefined, undefined)).toEqual(DEFAULT_NOTIFY_TIME);
    // `null` must not quietly become midnight.
    expect(normalizeNotifyTime(null, null)).toEqual(DEFAULT_NOTIFY_TIME);
    expect(normalizeNotifyTime(25, -1)).toEqual(DEFAULT_NOTIFY_TIME);
    expect(normalizeNotifyTime(0, 0)).toEqual({ hour: 0, minute: 0 });
  });
});

describe("when the notification is due", () => {
  const at = { hour: 9, minute: 30 };

  it("is not due before the send time, Sudan clock", () => {
    expect(notificationDue(khartoum(9, 29), at)).toBe(false);
    expect(notificationDue(khartoum(0, 0), at)).toBe(false);
  });

  it("is due from the send time through the late window", () => {
    expect(notificationDue(khartoum(9, 30), at)).toBe(true);
    expect(notificationDue(khartoum(11, 0), at)).toBe(true);
    const lastMinute = 9 * 60 + 30 + LATE_WINDOW_MINUTES - 1;
    expect(notificationDue(khartoum(Math.floor(lastMinute / 60), lastMinute % 60), at)).toBe(true);
  });

  it("is not due once the late window has passed", () => {
    const after = 9 * 60 + 30 + LATE_WINDOW_MINUTES;
    expect(notificationDue(khartoum(Math.floor(after / 60), after % 60), at)).toBe(false);
    expect(notificationDue(khartoum(23, 59), at)).toBe(false);
  });

  it("never spills a late window past midnight into the next day", () => {
    const late = { hour: 23, minute: 0 };
    expect(notificationDue(khartoum(23, 30), late)).toBe(true);
    expect(notificationDue(khartoum(0, 30, 15), late)).toBe(false);
  });

  it("reads the Sudan clock, not the host's", () => {
    // 07:30 UTC is 09:30 in Khartoum.
    expect(notificationDue(new Date("2026-10-14T07:30:00Z"), at)).toBe(true);
    expect(notificationDue(new Date("2026-10-14T07:29:00Z"), at)).toBe(false);
  });
});

describe("the dashboard's view of today", () => {
  const settings = { enabled: true, time: { hour: 9, minute: 0 } };

  it("tells each state apart", () => {
    expect(scheduleStatus(khartoum(8), settings, null)).toBe("upcoming");
    expect(scheduleStatus(khartoum(9, 1), settings, null)).toBe("sending");
    expect(scheduleStatus(khartoum(20), settings, null)).toBe("missed");
    expect(scheduleStatus(khartoum(20), settings, "2026-10-14")).toBe("sent");
    expect(scheduleStatus(khartoum(20), settings, "2026-10-13")).toBe("missed");
    expect(scheduleStatus(khartoum(8), { ...settings, enabled: false }, null)).toBe("disabled");
  });
});

describe("the message", () => {
  it("uses the built-in wording when the operator wrote none", () => {
    const message = notificationMessage({ title: null, body: null }, "2026-10-14");
    expect(message).toEqual({
      title: DEFAULT_NOTIFY_TITLE,
      body: DEFAULT_NOTIFY_BODY,
      url: "/",
      tag: "jradil-2026-10-14",
    });
  });

  it("uses the operator's wording when there is some", () => {
    const message = notificationMessage({ title: "عنوان", body: "نص" }, "2026-10-14");
    expect(message.title).toBe("عنوان");
    expect(message.body).toBe("نص");
  });

  it("keeps the house style: a hyphen, never an em dash", () => {
    expect(DEFAULT_NOTIFY_TITLE).not.toContain("—");
    expect(DEFAULT_NOTIFY_BODY).not.toContain("—");
  });

  it("treats blank operator copy as no copy, and trims it to length", () => {
    expect(cleanNotifyText("   ", 10)).toBeNull();
    expect(cleanNotifyText(null, 10)).toBeNull();
    expect(cleanNotifyText(42, 10)).toBeNull();
    expect(cleanNotifyText("  نص  ", 10)).toBe("نص");
    expect(cleanNotifyText("abcdefghijkl", 5)).toBe("abcde");
  });

  it("expires with the day it announces", () => {
    // 22:00 in Khartoum leaves two hours.
    expect(notificationTtlSeconds(khartoum(22))).toBe(2 * 60 * 60);
    expect(notificationTtlSeconds(khartoum(23, 59, 14))).toBeGreaterThanOrEqual(60);
  });
});

describe("which endpoints are accepted", () => {
  it("accepts the push services browsers use", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGx2",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
      "https://android.googleapis.com/gcm/send/abc",
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses anything the server should never be made to call", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://169.254.169.254/latest/meta-data",
      "https://mongo:27017/",
      "https://fcm.googleapis.com.evil.example/push",
      "https://evilfcm.googleapis.com/push",
      "https://fcm.googleapis.com:8443/push",
      "https://user:pass@fcm.googleapis.com/push",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it("checks the shape of the subscription keys", () => {
    const p256dh = `B${"A".repeat(86)}`;
    expect(P256DH_PATTERN.test(p256dh)).toBe(true);
    expect(P256DH_PATTERN.test("short")).toBe(false);
    expect(P256DH_PATTERN.test(`${"A".repeat(86)}<>`)).toBe(false);
    expect(AUTH_PATTERN.test("A".repeat(22))).toBe(true);
    expect(AUTH_PATTERN.test("A".repeat(40))).toBe(false);
  });
});

describe("keys", () => {
  it("decodes base64url, with or without padding", () => {
    expect([...base64UrlToBytes("AQID")]).toEqual([1, 2, 3]);
    expect([...base64UrlToBytes("-_8")]).toEqual([251, 255]);
    expect([...base64UrlToBytes("-_8=")]).toEqual([251, 255]);
  });

  it("compares a browser's key bytes with the server's base64url key", () => {
    const bytes = new Uint8Array([251, 255]).buffer;
    expect(sameKey(bytes, "-_8")).toBe(true);
    expect(sameKey(bytes, "AQID")).toBe(false);
    expect(sameKey(null, "AQID")).toBe(false);
  });
});
