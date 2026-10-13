import { describe, expect, it } from "vite-plus/test";

import { signProgress, verifyProgress } from "./progress.ts";

const SECRET = "test-secret";
const DAY = "2026-10-13";

describe("progress tokens", () => {
  it("needs no token before the first guess", () => {
    expect(verifyProgress(SECRET, DAY, 0, undefined)).toBe(true);
  });

  it("refuses a later guess that brings no token", () => {
    expect(verifyProgress(SECRET, DAY, 5, undefined)).toBe(false);
  });

  it("accepts the token the previous guess returned", () => {
    const token = signProgress(SECRET, DAY, 3);
    expect(verifyProgress(SECRET, DAY, 3, token)).toBe(true);
  });

  it("cannot be stretched to claim more guesses than were made", () => {
    const token = signProgress(SECRET, DAY, 1);
    expect(verifyProgress(SECRET, DAY, 5, token)).toBe(false);
  });

  it("cannot be replayed on another day", () => {
    const token = signProgress(SECRET, "2026-10-12", 5);
    expect(verifyProgress(SECRET, DAY, 5, token)).toBe(false);
  });

  it("cannot be forged without the server's key", () => {
    const token = signProgress("another-key", DAY, 5);
    expect(verifyProgress(SECRET, DAY, 5, token)).toBe(false);
    expect(verifyProgress(SECRET, DAY, 5, "x")).toBe(false);
  });
});
