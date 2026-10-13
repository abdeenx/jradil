import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { APP_NAME_AR, DESCRIPTION_AR, TITLE_AR } from "./config.ts";
import { OG_IMAGE_HEIGHT, OG_IMAGE_PATH, OG_IMAGE_WIDTH, socialMeta } from "./social.ts";

const CARD = readFileSync(new URL("../../public/og-image.png", import.meta.url));

function tag(meta: ReturnType<typeof socialMeta>, key: string): string | undefined {
  const found = meta.find((entry) => entry.property === key || entry.name === key);
  return found?.content;
}

describe("the social card image", () => {
  it("is a PNG", () => {
    expect([...CARD.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("is written at the size the metadata promises", () => {
    // Read straight out of the PNG header, so a card regenerated at another size
    // fails here rather than being silently letterboxed by every platform.
    expect(CARD.readUInt32BE(16)).toBe(OG_IMAGE_WIDTH);
    expect(CARD.readUInt32BE(20)).toBe(OG_IMAGE_HEIGHT);
  });

  it("is a wide card, not a thumbnail", () => {
    expect(OG_IMAGE_WIDTH / OG_IMAGE_HEIGHT).toBeGreaterThan(1.5);
  });
});

describe("socialMeta", () => {
  const withUrl = socialMeta("https://jradil.example.com");
  const withoutUrl = socialMeta(null);

  it("names the site and the page in Arabic", () => {
    expect(tag(withUrl, "og:site_name")).toBe(APP_NAME_AR);
    expect(tag(withUrl, "og:title")).toBe(TITLE_AR);
    expect(tag(withUrl, "og:description")).toBe(DESCRIPTION_AR);
    expect(tag(withUrl, "og:locale")).toBe("ar_SD");
  });

  it("points at the wordmark card, absolutely", () => {
    expect(tag(withUrl, "og:image")).toBe("https://jradil.example.com/og-image.png");
  });

  it("declares the image size, so platforms can reserve the space", () => {
    expect(tag(withUrl, "og:image:width")).toBe("1200");
    expect(tag(withUrl, "og:image:height")).toBe("630");
    expect(tag(withUrl, "og:image:type")).toBe("image/png");
  });

  it("asks for the wide card rather than a thumbnail", () => {
    expect(tag(withUrl, "twitter:card")).toBe("summary_large_image");
  });

  it("describes the image for anyone who cannot see it", () => {
    expect(tag(withUrl, "og:image:alt")).toContain(APP_NAME_AR);
    expect(tag(withUrl, "twitter:image:alt")).toContain(APP_NAME_AR);
  });

  it("carries the canonical address", () => {
    expect(tag(withUrl, "og:url")).toBe("https://jradil.example.com/");
  });

  it("does not double the slash on an address that ends in one", () => {
    const slashed = socialMeta("https://jradil.example.com/");
    expect(tag(slashed, "og:image")).toBe("https://jradil.example.com/og-image.png");
    expect(tag(slashed, "og:url")).toBe("https://jradil.example.com/");
  });

  it("falls back to a relative image when the deployment has no address", () => {
    // Facebook will not resolve this, but some clients do, and it beats nothing.
    expect(tag(withoutUrl, "og:image")).toBe(OG_IMAGE_PATH);
    expect(tag(withoutUrl, "og:url")).toBeUndefined();
  });

  it("still sets every tag that does not need the address", () => {
    expect(tag(withoutUrl, "twitter:card")).toBe("summary_large_image");
    expect(tag(withoutUrl, "og:title")).toBe(TITLE_AR);
  });
});
