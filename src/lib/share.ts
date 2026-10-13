/**
 * The "share your result" text.
 *
 * Lives outside the dialog component so the format can be tested without a
 * clipboard or a DOM — the string is the product here, not the button that
 * copies it.
 */

import type { LetterState } from "./arabic.ts";
import { NEXT_WORD_LABEL } from "./config.ts";
import { formatDuration } from "./sudan-time.ts";

/**
 * One emoji per letter state, chosen to echo the bucket the board draws:
 * a bucket for a letter in its right place, the amber square the game has always
 * used for one that is in the word but elsewhere, and a pouring vessel for one
 * that is not in the word at all — the water it could not keep.
 */
export const SHARE_TILES: Record<LetterState, string> = {
  correct: "🪣",
  present: "🟨",
  absent: "🫗",
};

/**
 * Builds the emoji grid.
 *
 * Each row is prefixed with a right-to-left mark so a client rendering
 * direction-neutral emoji still lays the row out the way the board does: the
 * first letter on the right.
 */
export function shareGrid(rows: readonly (readonly LetterState[])[]): string {
  return rows.map((row) => `\u200F${row.map((state) => SHARE_TILES[state]).join("")}`).join("\n");
}

export type ShareInput = {
  appName: string;
  /** Already formatted for display; the caller owns the locale work. */
  dateLabel: string;
  attempts: number;
  maxAttempts: number;
  states: readonly (readonly LetterState[])[];
  /** Milliseconds until the next word. */
  msRemaining: number;
  /** Public address of this deployment. Omitted from the text when empty. */
  appUrl: string | null;
};

export function buildShareText(input: ShareInput): string {
  /** The board itself: whose day it was, how it went, and the rows. */
  const board = [
    `${input.appName} — ${input.dateLabel}`,
    `${input.attempts}/${input.maxAttempts}`,
    shareGrid(input.states),
  ];

  /** Housekeeping: what is coming, and where to find it. */
  const footer = [`${NEXT_WORD_LABEL} ${formatDuration(input.msRemaining)}`];

  // A leading mark keeps the address reading left-to-right inside an otherwise
  // right-to-left message, so clients do not reorder its tail.
  if (input.appUrl) footer.push(`\u200E${input.appUrl}`);

  // One blank line apart, so the footer does not crowd the grid — the grid is
  // the part people actually read.
  return `${board.join("\n")}\n\n${footer.join("\n")}`;
}
