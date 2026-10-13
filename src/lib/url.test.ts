import { describe, expect, it } from "vite-plus/test";

import { isSafeExternalLink, normalizeExternalLink } from "./url.ts";

describe("normalizeExternalLink", () => {
  it("keeps http and https links", () => {
    expect(normalizeExternalLink("https://ar.wiktionary.org/wiki/طنجرة")).toContain(
      "https://ar.wiktionary.org",
    );
    expect(normalizeExternalLink("http://example.com")).toBe("http://example.com/");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeExternalLink("  https://example.com  ")).toBe("https://example.com/");
  });

  it("rejects the schemes that would make a stored link dangerous", () => {
    // The value is rendered straight into an href, so this is the only defence.
    expect(normalizeExternalLink("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalLink("JavaScript:alert(1)")).toBeNull();
    expect(normalizeExternalLink("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normalizeExternalLink("file:///etc/passwd")).toBeNull();
    expect(normalizeExternalLink("vbscript:msgbox(1)")).toBeNull();
  });

  it("treats blank and malformed values as no link", () => {
    expect(normalizeExternalLink("")).toBeNull();
    expect(normalizeExternalLink("   ")).toBeNull();
    expect(normalizeExternalLink("example.com")).toBeNull();
    expect(normalizeExternalLink("طنجرة")).toBeNull();
    expect(normalizeExternalLink(null)).toBeNull();
    expect(normalizeExternalLink(undefined)).toBeNull();
    expect(normalizeExternalLink(42)).toBeNull();
  });
});

describe("isSafeExternalLink", () => {
  it("narrows only real links", () => {
    expect(isSafeExternalLink("https://example.com")).toBe(true);
    expect(isSafeExternalLink("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalLink(null)).toBe(false);
  });
});
