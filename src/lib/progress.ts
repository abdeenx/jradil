/**
 * Signed proof of how many guesses a player has made today.
 *
 * The game keeps no per-player state on the server, so the attempt count comes
 * from the client — and the count is what unlocks the answer. Each accepted
 * guess is answered with a token for the new count, and any guess after the
 * first must present the token for the count it claims. Reaching the reveal
 * therefore costs exactly as many real guesses as playing does; a client can no
 * longer claim "five guesses so far" on its first request and read the word.
 *
 * Tokens carry the day, so yesterday's cannot be replayed today.
 */

import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { DateKey } from "./sudan-time.ts";

export function signProgress(secret: string, dateKey: DateKey, attempts: number): string {
  return createHmac("sha256", secret)
    .update(`jradil-progress:${dateKey}:${attempts}`)
    .digest("base64url");
}

/** True when `token` vouches for exactly `attempts` guesses on `dateKey`. */
export function verifyProgress(
  secret: string,
  dateKey: DateKey,
  attempts: number,
  token: string | undefined,
): boolean {
  // Nothing to prove before the first guess.
  if (attempts === 0) return true;
  if (!token) return false;

  const expected = Buffer.from(signProgress(secret, dateKey, attempts));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
