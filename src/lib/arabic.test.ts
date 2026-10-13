import { describe, expect, it } from "vite-plus/test";

import { isPlayableWord, normalizeArabic, scoreGuess, toLetters } from "./arabic.ts";

describe("normalizeArabic", () => {
  it("folds the alef, hamza and taa marbuta spellings a reader treats as the same", () => {
    expect(normalizeArabic("أسعار")).toBe("اسعار");
    expect(normalizeArabic("إبرة")).toBe("ابره");
    expect(normalizeArabic("مدرسة")).toBe("مدرسه");
  });

  it("folds the letters Sudanese dialect uses for g and v", () => {
    expect(normalizeArabic("ڨمر")).toBe("قمر");
    expect(normalizeArabic("گمر")).toBe("قمر");
  });

  it("drops diacritics, tatweel and zero-width marks", () => {
    expect(normalizeArabic("مَدْرَسَة")).toBe("مدرسه");
    expect(normalizeArabic("مـدـرسـة")).toBe("مدرسه");
    expect(normalizeArabic("مدرسه\u200f")).toBe("مدرسه");
  });
});

describe("isPlayableWord", () => {
  it("accepts exactly five Arabic letters", () => {
    expect(isPlayableWord("مدرسه")).toBe(true);
    expect(isPlayableWord("أسعار")).toBe(true);
  });

  it("rejects anything that is not five Arabic letters", () => {
    expect(isPlayableWord("مدر")).toBe(false);
    expect(isPlayableWord("مدرسه1")).toBe(false);
    expect(isPlayableWord("hello")).toBe(false);
    expect(isPlayableWord("مدرسهس")).toBe(false);
  });

  it("ignores spacing, so a stray space does not block a valid guess", () => {
    expect(isPlayableWord("مدرسه ")).toBe(true);
    expect(isPlayableWord(" مدرسه")).toBe(true);
  });

  it("counts letters, not code units", () => {
    expect(toLetters("مدرسه")).toHaveLength(5);
    expect(toLetters("مَدْرَسَة")).toHaveLength(5);
  });
});

describe("scoreGuess", () => {
  it("marks exact positions first", () => {
    expect(scoreGuess("مدرسه", "مدرسه")).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
  });

  it("never lets a repeated guess letter out-claim the answer", () => {
    // The answer holds three saa's; the guess offers four.
    expect(scoreGuess("سسسسه", "سسسمم")).toEqual([
      "correct",
      "correct",
      "correct",
      "absent",
      "absent",
    ]);
  });

  it("consumes one occurrence of the answer per present letter", () => {
    // One unmatched saa is left in the answer, so only one of the two
    // remaining guess letters can be marked present.
    expect(scoreGuess("هسسسس", "سسسمم")).toEqual([
      "absent",
      "correct",
      "correct",
      "present",
      "absent",
    ]);
  });

  it("marks the same letter the same way regardless of how it was typed", () => {
    expect(scoreGuess("أسعار", "اسعار")).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
  });
});
