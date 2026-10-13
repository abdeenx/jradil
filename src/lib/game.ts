/**
 * Client-side shapes for a day's play. Kept outside React so both the state
 * hook and the presentational components can share them.
 */

import type { LetterState } from "./arabic.ts";

/** One completed guess, exactly as it is rendered on the board. */
export type GameRow = { letters: string[]; states: LetterState[] };

/** Where the player stands for the day. */
export type GameStatus = "playing" | "won" | "lost";
