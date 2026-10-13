import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { BUCKET_EMPTY, BUCKET_RESIDUE, bucketAppearance } from "./bucket.ts";

const RESULTS = ["correct", "present", "absent"] as const;

/** The stylesheet is read so the two greys can be checked against each other. */
const STYLESHEET = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/**
 * The `base-content` share of a `color-mix` declaration.
 *
 * Both greys are mixed from `base-content` and `base-100`, so a higher share is
 * further from the page — which is what "darker" means here, whichever way round
 * the active theme runs.
 */
function baseContentShare(variable: string): number {
  const match = new RegExp(
    `${variable}:\\s*color-mix\\(\\s*in oklab,\\s*var\\(--color-base-content\\)\\s*(\\d+)%`,
  ).exec(STYLESHEET);
  if (!match) throw new Error(`no color-mix found for ${variable}`);
  return Number(match[1]);
}

describe("bucketAppearance", () => {
  describe("before a guess is marked", () => {
    it("is a dry bucket with no reveal", () => {
      expect(bucketAppearance(undefined, false)).toEqual({
        waterOffset: BUCKET_EMPTY,
        animateWater: null,
        water: "plain",
        animateWaterTone: false,
        ink: "base",
        animateInk: false,
        gray: false,
        animateGray: false,
      });
    });

    it("still shows no water even if something asks it to animate", () => {
      // Only a resolved row animates, so an unresolved bucket must stay dry.
      expect(bucketAppearance(undefined, true).animateWater).toBeNull();
      expect(bucketAppearance(undefined, true).waterOffset).toBe(BUCKET_EMPTY);
    });
  });

  describe("a letter in its right place", () => {
    it("fills to the brim and turns blue", () => {
      const look = bucketAppearance("correct", true);
      expect(look.waterOffset).toBe(0);
      expect(look.animateWater).toBe("fill");
      expect(look.water).toBe("correct");
      expect(look.animateWaterTone).toBe(true);
      expect(look.ink).toBe("info");
      expect(look.gray).toBe(false);
    });
  });

  describe("a letter in the word but in another place", () => {
    it("fills to the brim as well, but in the darker of the two greys", () => {
      const look = bucketAppearance("present", true);
      expect(look.waterOffset).toBe(0);
      expect(look.animateWater).toBe("fill");
      expect(look.water).toBe("present");
      expect(look.animateWaterTone).toBe(true);
      expect(look.gray).toBe(false);
    });
  });

  describe("a letter that is not in the word", () => {
    it("fills, then seeps down to a shallow residue", () => {
      const look = bucketAppearance("absent", true);
      expect(look.animateWater).toBe("drain");
      expect(look.waterOffset).toBe(BUCKET_RESIDUE);
    });

    it("keeps water in the bucket rather than emptying it", () => {
      expect(BUCKET_RESIDUE).toBeGreaterThan(0);
      expect(BUCKET_RESIDUE).toBeLessThan(BUCKET_EMPTY);
    });

    it("greys the bucket instead of darkening it to black", () => {
      const look = bucketAppearance("absent", true);
      expect(look.gray).toBe(true);
      expect(look.animateGray).toBe(true);
      expect(look.water).toBe("gray");
    });

    it("is not green", () => {
      // The bucket palette reads the stylesheet directly, so this catches the
      // water drifting back to a success tone.
      expect(STYLESHEET).toMatch(/--bucket-water-correct:\s*var\(--color-info\)/);
      expect(STYLESHEET).not.toMatch(/--bucket-water-correct:\s*var\(--color-success\)/);
    });

    it("uses the lighter of the two greys", () => {
      // Enforced against the stylesheet, because the two tones are only
      // distinguishable by eye otherwise.
      expect(baseContentShare("--bucket-water-gray")).toBeLessThan(
        baseContentShare("--bucket-water-present"),
      );
    });

    it("keeps its bucket a shade lighter than the water it left behind", () => {
      expect(baseContentShare("--bucket-gray-surface")).toBeLessThan(
        baseContentShare("--bucket-water-gray"),
      );
    });
  });

  describe("telling the three results apart", () => {
    it("gives every result a water colour of its own", () => {
      const waters = RESULTS.map((result) => bucketAppearance(result, true).water);
      expect(new Set(waters).size).toBe(3);
    });

    it("separates wrong-place from not-in-the-word on colour, not just level", () => {
      // Two neutral states would be told apart only by how much water is left,
      // which is exactly the confusion this guards against.
      const present = bucketAppearance("present", true);
      const absent = bucketAppearance("absent", true);
      expect(present.water).not.toBe(absent.water);
      expect(present.waterOffset).not.toBe(absent.waterOffset);
      expect(present.gray).not.toBe(absent.gray);
    });

    it("settles at three distinct water levels", () => {
      const levels = new Set([
        bucketAppearance("present", true).waterOffset,
        bucketAppearance("absent", true).waterOffset,
        bucketAppearance(undefined, false).waterOffset,
      ]);
      expect(levels.size).toBe(3);
    });

    it("never pours coloured water before the guess has been read", () => {
      // A bucket always fills plain first, so the water itself is not a clue.
      const look = bucketAppearance("correct", true);
      expect(look.animateWaterTone).toBe(true);
      expect(look.water).not.toBe("plain");
    });
  });

  describe("a bucket restored from a previous session", () => {
    it("renders the settled graphic instead of replaying the reveal", () => {
      for (const result of RESULTS) {
        const look = bucketAppearance(result, false);
        expect(look.animateWater).toBeNull();
        expect(look.animateWaterTone).toBe(false);
        expect(look.animateInk).toBe(false);
        expect(look.animateGray).toBe(false);
      }
    });

    it("still shows the settled colours and levels", () => {
      const filled = bucketAppearance("correct", false);
      expect(filled.waterOffset).toBe(0);
      expect(filled.water).toBe("correct");

      const drained = bucketAppearance("absent", false);
      expect(drained.waterOffset).toBe(BUCKET_RESIDUE);
      expect(drained.gray).toBe(true);
    });
  });

  describe("the letter's own colour", () => {
    it("follows the water so it stays readable", () => {
      expect(bucketAppearance("correct", true).ink).toBe("info");
      // Sunk in the darker grey pool, the letter takes the theme's far end.
      expect(bucketAppearance("present", true).ink).toBe("onGray");
      // A grey bucket keeps the ordinary ink.
      expect(bucketAppearance("absent", true).ink).toBe("base");
      expect(bucketAppearance(undefined, false).ink).toBe("base");
    });

    it("is only animated when it actually changes", () => {
      expect(bucketAppearance("correct", true).animateInk).toBe(true);
      expect(bucketAppearance("present", true).animateInk).toBe(true);
      expect(bucketAppearance("absent", true).animateInk).toBe(false);
    });
  });

  it("rests exactly where the drain animation ends", () => {
    // The resting offset and the drain keyframes have to agree, or a bucket
    // would visibly jump the moment its animation is dropped.
    expect(bucketAppearance("absent", true).waterOffset).toBe(BUCKET_RESIDUE);
    expect(bucketAppearance("absent", false).waterOffset).toBe(BUCKET_RESIDUE);
  });
});
