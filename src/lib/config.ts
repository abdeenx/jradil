/**
 * Shared, environment-independent constants.
 *
 * The puzzle is a classic Wordle: every word is exactly {@link WORD_LETTER_COUNT}
 * letters long and the player gets {@link MAX_ATTEMPTS} tries.
 */

/** Every playable word has exactly this many letters (diacritics excluded). */
export const WORD_LETTER_COUNT = 5;

/** How many guesses a player gets per day. */
export const MAX_ATTEMPTS = 6;

/** Default size of the auto-pick candidate pool, editable by the operator. */
export const DEFAULT_POOL_SIZE = 30;

/** The single MongoDB collection that holds every document. */
export const COLLECTION_NAME = "jradil";

/** App name shown in the UI. */
export const APP_NAME_AR = "جرادل";

/** Sudan runs on UTC+2 all year: no daylight saving transitions. */
export const SUDAN_UTC_OFFSET_MINUTES = 120;
