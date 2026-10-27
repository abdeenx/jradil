/**
 * Ordering choices for the review queue.
 *
 * Kept apart from `unknown-words.ts` on purpose: that module reaches the
 * database and is server-only, while the admin route needs the names to parse
 * and render the sort control. A type-only import would be erased, but the
 * constant array is a runtime value and would drag Mongoose into the browser
 * bundle.
 *
 * `recent` is the working order: the word a player reached for a minute ago is
 * the one with someone still waiting. `tries` is the dictionary-gap order: a
 * word many people tried is more likely a real word than a typo, which is what
 * matters when the operator is choosing what to add rather than what to answer.
 */
export const UNKNOWN_WORD_SORTS = ["recent", "tries"] as const;
export type UnknownWordsSort = (typeof UNKNOWN_WORD_SORTS)[number];
