/**
 * The tab icon and the app's name have to agree.
 *
 * The favicon is a single bucket carrying the name's first letter, so it has to
 * draw the letter the name actually starts with. It also copies the board's
 * bucket geometry by hand — the header wordmark does not, since it renders the
 * board's own component, so this is the one place that can drift.
 *
 * Both files are read as text, so this needs no component renderer.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { APP_NAME_AR } from "./config.ts";

const FAVICON = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8");
const BUCKET = readFileSync(new URL("../components/Bucket.tsx", import.meta.url), "utf8");

function pathConstant(name: string): string {
  const match = new RegExp(`const ${name} = "([^"]+)"`).exec(BUCKET);
  if (!match) throw new Error(`${name} not found in Bucket.tsx`);
  return match[1];
}

describe("the tab icon", () => {
  it("draws the same letter the app's name begins with", () => {
    // Array.from iterates code points, which is how the rest of the app reads Arabic.
    const firstLetter = Array.from(APP_NAME_AR)[0];
    expect(FAVICON).toMatch(new RegExp(`>\\s*${firstLetter}\\s*</text>`));
  });

  it("carries a letter the name actually starts with", () => {
    // A rename that no longer starts with ج leaves the icon showing the wrong
    // initial, with nothing else in the app to catch it.
    expect(APP_NAME_AR.startsWith("ج")).toBe(true);
  });
});

describe("the mark's artwork", () => {
  it("uses the same bucket body as the board", () => {
    expect(FAVICON).toContain(pathConstant("BODY_PATH"));
  });

  it("clips its water to the same interior as the board", () => {
    expect(FAVICON).toContain(pathConstant("INTERIOR_PATH"));
  });

  it("keeps the water a blue, not the theme's other state colours", () => {
    expect(FAVICON).toContain("#00BAFE");
  });
});
