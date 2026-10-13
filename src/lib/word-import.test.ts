import { describe, expect, it } from "vite-plus/test";

import { parseFlag, parseWordPayload } from "./word-import.ts";

describe("parseFlag", () => {
  it("reads the ways a spreadsheet writes a boolean", () => {
    expect(parseFlag("true")).toBe(true);
    expect(parseFlag("1")).toBe(true);
    expect(parseFlag("نعم")).toBe(true);
    expect(parseFlag("false")).toBe(false);
    expect(parseFlag("0")).toBe(false);
    expect(parseFlag("لا")).toBe(false);
  });

  it("treats an empty or unknown value as unset, not as false", () => {
    expect(parseFlag("")).toBeUndefined();
    expect(parseFlag(undefined)).toBeUndefined();
    expect(parseFlag("ربما")).toBeUndefined();
  });
});

describe("parseWordPayload", () => {
  it("reads one word per line", () => {
    const { words } = parseWordPayload("مدرسه\nجامعه\nكركديه");
    expect(words.map((word) => word.text)).toEqual(["مدرسه", "جامعه", "كركديه"]);
    expect(words[0]?.dialect).toBeUndefined();
  });

  it("reads a JSON array of strings", () => {
    const { words } = parseWordPayload('["مدرسه", "جامعه"]');
    expect(words.map((word) => word.text)).toEqual(["مدرسه", "جامعه"]);
  });

  it("reads a JSON array of objects", () => {
    const { words } = parseWordPayload(
      '[{"text":"مدرسه","dialect":true,"pool":true,"notes":"ملاحظة"}]',
    );
    expect(words).toEqual([{ text: "مدرسه", dialect: true, pool: true, notes: "ملاحظة" }]);
  });

  it("reads a wrapped JSON object", () => {
    const { words } = parseWordPayload('{"words":[{"word":"مدرسه"}]}');
    expect(words.map((word) => word.text)).toEqual(["مدرسه"]);
  });

  it("reads newline-delimited JSON", () => {
    const { words } = parseWordPayload('{"text":"مدرسه"}\n{"text":"جامعه"}');
    expect(words.map((word) => word.text)).toEqual(["مدرسه", "جامعه"]);
  });

  it("reads CSV with a header row, in any column order", () => {
    const { words } = parseWordPayload("pool,dialect,word\n1,1,طنجره\n0,1,عربيه");
    expect(words).toEqual([
      { text: "طنجره", dialect: true, pool: true, notes: undefined },
      { text: "عربيه", dialect: true, pool: false, notes: undefined },
    ]);
  });

  it("reads position-CSV without a header", () => {
    const { words } = parseWordPayload("طنجره,1,1\nعربيه,1,0");
    expect(words.map((word) => [word.text, word.dialect, word.pool])).toEqual([
      ["طنجره", true, true],
      ["عربيه", true, false],
    ]);
  });

  it("accepts an Arabic comma as the delimiter", () => {
    const { words } = parseWordPayload("طنجره،1،1");
    expect(words[0]).toMatchObject({ text: "طنجره", dialect: true, pool: true });
  });

  it("keeps quoted fields together and strips a byte-order mark", () => {
    const { words } = parseWordPayload('\uFEFF"طنجره","1","1"');
    expect(words[0]).toMatchObject({ text: "طنجره", dialect: true });
  });

  it("reports truncation instead of silently dropping rows", () => {
    const payload = Array.from({ length: 60_000 }, (_, index) => `كلمة${index}`).join("\n");
    const { truncated, words } = parseWordPayload(payload);
    expect(truncated).toBe(true);
    expect(words).toHaveLength(50_000);
  });

  it("carries a learn-more link through from a CSV column", () => {
    const { words } = parseWordPayload("word,link\nطنجره,https://ar.wiktionary.org/wiki/طنجرة");
    expect(words[0]).toMatchObject({
      text: "طنجره",
      link: "https://ar.wiktionary.org/wiki/طنجرة",
    });
  });

  it("carries a learn-more link through from JSON", () => {
    const { words } = parseWordPayload('[{"text":"طنجره","link":"https://example.com/w"}]');
    expect(words[0]?.link).toBe("https://example.com/w");
  });

  it("returns nothing for an empty payload", () => {
    expect(parseWordPayload("   \n  ").words).toEqual([]);
  });

  it("returns nothing for JSON that is not a word list", () => {
    expect(parseWordPayload('{"unexpected":true}').words).toEqual([]);
  });
});
