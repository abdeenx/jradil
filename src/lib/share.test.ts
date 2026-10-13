import { describe, expect, it } from "vite-plus/test";

import { SHARE_TILES, buildShareText, shareGrid, type ShareInput } from "./share.ts";

const BASE: ShareInput = {
  appName: "جرادل",
  dateLabel: "الثلاثاء 13 أكتوبر",
  attempts: 3,
  maxAttempts: 6,
  states: [["correct", "present", "absent", "correct", "present"]],
  msRemaining: 3 * 3600_000 + 4 * 60_000 + 9_000,
  appUrl: "https://jradil.example.com",
};

describe("SHARE_TILES", () => {
  it("marks a right letter with the bucket", () => {
    expect(SHARE_TILES.correct).toBe("🪣");
  });

  it("leaves the in-word-but-misplaced square as it was", () => {
    expect(SHARE_TILES.present).toBe("🟨");
  });

  it("marks a letter that is not in the word with a pouring vessel", () => {
    expect(SHARE_TILES.absent).toBe("🫗");
  });

  it("uses a single code point per tile, so the columns line up", () => {
    // A multi-codepoint emoji — a joined sequence, or one carrying a variation
    // selector — renders at a different width and skews every row of the grid.
    for (const [state, tile] of Object.entries(SHARE_TILES)) {
      expect(Array.from(tile), `${state} should be one emoji`).toHaveLength(1);
    }
  });
});

describe("shareGrid", () => {
  it("keeps each row in word order", () => {
    const grid = shareGrid([["correct", "present", "absent"]]);
    expect(grid).toBe("\u200F🪣🟨🫗");
  });

  it("marks every row so clients lay it out right to left", () => {
    const grid = shareGrid([["correct"], ["absent"], ["present"]]);
    const rows = grid.split("\n");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.startsWith("\u200F"))).toBe(true);
  });

  it("does not mark anything else, which would widen the grid", () => {
    expect(shareGrid([["correct"]])).toHaveLength(1 + "🪣".length);
  });
});

describe("buildShareText", () => {
  it("stacks who, how many, the grid, the countdown and the link", () => {
    const lines = buildShareText(BASE).split("\n");

    expect(lines[0]).toBe("جرادل — الثلاثاء 13 أكتوبر");
    expect(lines[1]).toBe("3/6");
    expect(lines[2]).toBe("\u200F🪣🟨🫗🪣🟨");
    expect(lines[3]).toBe("الكلمة القادمة بعد 03:04:09");
    expect(lines[4]).toBe("\u200Ehttps://jradil.example.com");
  });

  it("puts the grid above the countdown, on its own line", () => {
    const text = buildShareText(BASE);
    expect(text.indexOf("🪣")).toBeLessThan(text.indexOf("الكلمة القادمة بعد"));
  });

  it("leaves the link out when the deployment has no address", () => {
    const text = buildShareText({ ...BASE, appUrl: null });
    expect(text).not.toContain("http");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("still shows the countdown when the link is missing", () => {
    expect(buildShareText({ ...BASE, appUrl: null })).toContain("الكلمة القادمة بعد 03:04:09");
  });

  it("formats the countdown as a clock, not a raw number", () => {
    expect(buildShareText({ ...BASE, msRemaining: 1000 })).toContain("00:00:01");
    expect(buildShareText({ ...BASE, msRemaining: 0 })).toContain("00:00:00");
  });

  it("handles a game that ran out of attempts", () => {
    const text = buildShareText({ ...BASE, attempts: 6 });
    expect(text).toContain("6/6");
  });

  it("writes the address after the countdown, not before", () => {
    const text = buildShareText(BASE);
    expect(text.indexOf("الكلمة القادمة بعد")).toBeLessThan(text.indexOf("https://"));
  });
});
