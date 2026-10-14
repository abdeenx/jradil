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

/** What the browser offers for getting the text out. Injected so it can be tested. */
export type ShareTarget = {
  /** `navigator.share`, when the browser has one. */
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  /** Whether this is a phone or tablet, where the system share sheet is the natural place. */
  touch: boolean;
  copy: (text: string) => Promise<void>;
};

export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/**
 * Hands the result to the system share sheet on a phone, so the player can pick
 * WhatsApp (a chat or their status), or any other app, and copies it elsewhere.
 *
 * Must be called straight from the click, with nothing awaited first: browsers
 * only open the share sheet in response to a fresh user gesture.
 */
export async function deliverShareText(text: string, target: ShareTarget): Promise<ShareOutcome> {
  // Text only, no separate `url`: the address is already in the text, and some
  // apps keep only one of the two fields when given both.
  const data: ShareData = { text };
  if (target.touch && target.share && (target.canShare?.(data) ?? true)) {
    try {
      await target.share(data);
      return "shared";
    } catch (error) {
      // The player closed the sheet: they chose not to share, so nothing else happens.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Anything else (no share targets, a policy block): copying still works.
    }
  }
  try {
    await target.copy(text);
    return "copied";
  } catch {
    return "failed";
  }
}
