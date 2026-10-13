import { describe, expect, it } from "vite-plus/test";

import { MAX_PAGE, enumParam, pageParam, textParam } from "./search-params.ts";

describe("pageParam", () => {
  it("reads a page number from the URL", () => {
    expect(pageParam("3")).toBe(3);
    expect(pageParam(7)).toBe(7);
  });

  it("falls back to the first page for anything malformed", () => {
    expect(pageParam(undefined)).toBe(1);
    expect(pageParam("")).toBe(1);
    expect(pageParam("0")).toBe(1);
    expect(pageParam("-2")).toBe(1);
    expect(pageParam("1.5")).toBe(1);
    expect(pageParam("abc")).toBe(1);
  });

  it("never asks the server for a page it would refuse", () => {
    expect(pageParam(String(MAX_PAGE * 10))).toBe(MAX_PAGE);
  });
});

describe("textParam", () => {
  it("keeps a string and bounds its length", () => {
    expect(textParam("مدرسة", 200)).toBe("مدرسة");
    expect(textParam("a".repeat(300), 200)).toHaveLength(200);
  });

  it("drops anything that is not a string", () => {
    expect(textParam(42, 200)).toBe("");
    expect(textParam(undefined, 200)).toBe("");
  });
});

describe("enumParam", () => {
  const options = ["all", "pool"] as const;

  it("keeps a known value and replaces an unknown one", () => {
    expect(enumParam("pool", options, "all")).toBe("pool");
    expect(enumParam("anything", options, "all")).toBe("all");
    expect(enumParam(undefined, options, "all")).toBe("all");
  });
});
