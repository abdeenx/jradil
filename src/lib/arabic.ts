/**
 * Arabic text handling for the puzzle.
 *
 * Two jobs live here:
 *
 * 1. **Normalisation.** Players type `ا` where the stored word has `أ`, or `ه`
 *    where it has `ة`. Both spellings are the same letter to a reader, so the
 *    game folds them before comparing. Sudanese dialect also writes the /g/
 *    and /v/ sounds with letters that are uncommon in Standard Arabic
 *    (`ڨ`, `گ`, `ڤ`); those fold onto their closest Standard Arabic letter.
 *
 * 2. **Scoring.** Classic Wordle marking, computed on the folded letters so a
 *    repeated letter can only be marked as often as it truly occurs.
 */

import { WORD_LETTER_COUNT } from "./config.ts";

export type LetterState = "correct" | "present" | "absent";

/** The 28 letters that can appear on a bucket or a key. */
export const BASE_LETTERS = [
  "ا",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ك",
  "ل",
  "م",
  "ن",
  "ه",
  "و",
  "ي",
] as const;

const BASE_LETTER_SET: ReadonlySet<string> = new Set(BASE_LETTERS);

/**
 * On-screen keypad, laid out like Gboard's Arabic keyboard, the layout most
 * players already type on. Rows are listed from the right, where an Arabic
 * reader starts.
 *
 * Players may press any key that folds onto a base letter — `ى ة ؤ` as well as
 * the 28 — and the game folds the guess itself before comparing, so typing
 * `مدرسة` or `مدرسه` is the same guess. `ء` is the one key left disabled: it
 * folds onto nothing, so no answer can contain it.
 */
export const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ذ", "ء", "ؤ", "ر", "ى", "ة", "و", "ز", "ظ", "د"],
];

/** Marks that carry no letter of their own and are dropped before comparing. */
const DIACRITICS_AND_TATWEEL =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\u2060\uFEFF]/g;

/** Letters that are interchangeable with a plainer spelling. */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  // alef variants → bare alef
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ٲ: "ا",
  ٳ: "ا",
  ٵ: "ا",
  // taa marbuta → haa
  ة: "ه",
  ۀ: "ه",
  // alef maqsura and yaa variants → yaa
  ى: "ي",
  ئ: "ي",
  ې: "ي",
  ے: "ي",
  // waw variants
  ؤ: "و",
  ۆ: "و",
  // Sudanese dialect letters folded onto Standard Arabic
  ڨ: "ق",
  گ: "ق",
  ݣ: "ق",
  ڠ: "ق",
  ڤ: "ف",
  ڥ: "ف",
  پ: "ب",
  چ: "ج",
  ژ: "ز",
  ڛ: "س",
  ڵ: "ل",
};

/** The base letter a single character folds onto, or the character itself. */
export function foldLetter(character: string): string {
  return LETTER_FOLDS[character] ?? character;
}

/** Removes diacritics, tatweel and zero-width marks. */
export function stripMarks(input: string): string {
  return input.replace(DIACRITICS_AND_TATWEEL, "");
}

/** Folds a string to the canonical form used for comparison and storage. */
export function normalizeArabic(input: string): string {
  const stripped = stripMarks(input.normalize("NFC"));
  let output = "";
  for (const character of stripped) {
    if (character === " ") continue;
    output += foldLetter(character);
  }
  return output;
}

/**
 * Splits a string into its canonical letters.
 *
 * Code-point iteration is correct here: `normalizeArabic` strips the combining
 * marks first, so every remaining Arabic letter is one code point and no
 * grapheme cluster can be split.
 */
export function toLetters(input: string): string[] {
  // oxlint-disable-next-line typescript/no-misused-spread -- see doc comment
  return [...normalizeArabic(input)];
}

/** Number of letters a reader sees, ignoring diacritics and spacing. */
export function letterCount(input: string): number {
  return toLetters(input).length;
}

export function isBaseLetter(character: string): boolean {
  return BASE_LETTER_SET.has(character);
}

/** True for a single character a player may type: a base letter or a spelling of one. */
export function isTypableLetter(character: string): boolean {
  return isBaseLetter(foldLetter(character));
}

/** True when the text is a well-formed guess: five Arabic letters, nothing else. */
export function isPlayableWord(input: string): boolean {
  const letters = toLetters(input);
  return letters.length === WORD_LETTER_COUNT && letters.every(isBaseLetter);
}

/** One letter of a word, canonicalised but keeping the original for display. */
export type WordLetter = {
  /** What the player typed, marks removed. */
  display: string;
  /** The folded letter used for comparison. */
  canonical: string;
};

/** Turns text into display/canonical letter pairs. */
export function toWordLetters(input: string): WordLetter[] {
  // oxlint-disable-next-line typescript/no-misused-spread -- marks are stripped first
  const display = [...stripMarks(input.normalize("NFC"))].filter((c) => c !== " ");
  return display.map((character) => ({
    display: character,
    canonical: foldLetter(character),
  }));
}

/**
 * Marks a guess against the answer.
 *
 * Correct letters are claimed first, then each remaining guess letter consumes
 * one unused occurrence of the same letter in the answer. That is what stops a
 * guess like `سسسسس` from turning every tile yellow when the answer has one `س`.
 */
export function scoreGuess(guess: string, answer: string): LetterState[] {
  const guessLetters = toLetters(guess);
  const answerLetters = toLetters(answer);
  const states: LetterState[] = guessLetters.map(() => "absent");
  const unclaimed = new Map<string, number>();

  for (let index = 0; index < answerLetters.length; index += 1) {
    const letter = answerLetters[index];
    if (guessLetters[index] === letter) {
      states[index] = "correct";
    } else {
      unclaimed.set(letter, (unclaimed.get(letter) ?? 0) + 1);
    }
  }

  for (let index = 0; index < guessLetters.length; index += 1) {
    if (states[index] === "correct") continue;
    const letter = guessLetters[index];
    const available = unclaimed.get(letter) ?? 0;
    if (available > 0) {
      states[index] = "present";
      unclaimed.set(letter, available - 1);
    }
  }

  return states;
}

/**
 * Collapses every guess into the best state seen for each letter, for the
 * on-screen keypad. Rows keep the letters as typed, so they are folded here: an
 * `ة` in a guess lights the `ه` key. A letter that has never been guessed is
 * simply absent from the map.
 */
export function keypadStates(
  guesses: readonly { letters: readonly string[]; states: readonly LetterState[] }[],
): Record<string, LetterState> {
  const result: Record<string, LetterState> = {};
  const rank: Record<LetterState, number> = { absent: 1, present: 2, correct: 3 };

  for (const guess of guesses) {
    guess.letters.forEach((typed, index) => {
      const letter = foldLetter(typed);
      const state = guess.states[index];
      if (!state) return;
      const current = result[letter];
      if (current === undefined || rank[state] > rank[current]) {
        result[letter] = state;
      }
    });
  }

  return result;
}
