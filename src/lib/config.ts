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
export const APP_NAME_AR = "جرادل - لعبة كلمة اليوم";

/**
 * The name the header wordmark spells, one bucket per character — so the bare
 * name only, never a phrase.
 */
export const WORDMARK_AR = "جرادل";

/** One-line pitch, under the wordmark and in social previews. */
export const TAGLINE_AR = "كلمة جديدة من اللهجة السودانية كل يوم";

/** Page title, and the title social previews show. A plain hyphen, never an em dash. */
export const TITLE_AR = `${APP_NAME_AR} - ${TAGLINE_AR}`;

/** What the game is, long enough to explain itself in a search result or a card. */
export const DESCRIPTION_AR =
  "لعبة كلمة اليوم باللهجة السودانية: خمسة حروف، ست محاولات، وكلمة جديدة كل يوم عند منتصف الليل بتوقيت الخرطوم.";

/** Countdown phrase, used both on screen and in the share text. */
export const NEXT_WORD_LABEL = "الكلمة القادمة بعد";

/** Sudan runs on UTC+2 all year: no daylight saving transitions. */
export const SUDAN_UTC_OFFSET_MINUTES = 120;
