/**
 * The public game API.
 *
 * The answer never leaves the server until the game is over. The client is told
 * how long the word is and how many tries it gets, sends each guess for
 * marking, and only learns the word when it has won or run out of attempts.
 *
 * Calling `getPuzzle` is also what triggers the automatic pick for the day, so
 * no scheduler is required: the first player after Sudan midnight materialises
 * the word, and the unique day record guarantees everyone after them sees the
 * same one.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { isPlayableWord, scoreGuess, toWordLetters, type LetterState } from "#/lib/arabic.ts";
import { MAX_ATTEMPTS, WORD_LETTER_COUNT } from "#/lib/config.ts";
import { optionalEnv } from "#/lib/env.ts";
import { signProgress, verifyProgress } from "#/lib/progress.ts";
import { dayEndUtc, dayStartUtc, isDateKey, sudanDateKey, type DateKey } from "#/lib/sudan-time.ts";
import { startReminderScheduler } from "#/lib/push-scheduler.ts";
import { recordUnknownWord } from "#/lib/unknown-words.ts";
import { getGameSecret, getSettings, getWordByText, resolveDay, wordExists } from "#/lib/words.ts";

/**
 * What the player's board can be. A player only ever asks about today, and today
 * either has a word or does not, so there are only two outcomes.
 */
export type PuzzleState = "ready" | "no-words";

export type PuzzlePayload = {
  /** The day being played, in Sudan time. */
  dateKey: DateKey;
  /** The server's current Sudan day, so a stale tab can resync at midnight. */
  todayKey: DateKey;
  letterCount: number;
  maxAttempts: number;
  /** ISO instants for when this puzzle opened and when the next one opens. */
  startsAt: string;
  endsAt: string;
  /** Milliseconds left on the server's clock when this payload was produced. */
  msRemaining: number;
  /**
   * Public address of this deployment, from `APP_URL`. Null when unset, in which
   * case the share text simply leaves the link out.
   */
  appUrl: string | null;
  state: PuzzleState;
};

export type GuessPayload =
  | {
      ok: true;
      states: LetterState[];
      /** The letters the player typed, for display in the row. */
      letters: string[];
      solved: boolean;
      /** True once the game cannot continue: solved, or out of attempts. */
      finished: boolean;
      attemptsUsed: number;
      /** Proof of `attemptsUsed`, to send back with the next guess. */
      progress: string;
      /** Present only when the game is over. */
      answer: string | null;
      /** Optional operator-supplied page about the word, revealed with the answer. */
      link: string | null;
    }
  | { ok: false; reason: string; message: string };

function puzzlePayload(dateKey: DateKey, state: PuzzleState, now: Date): PuzzlePayload {
  return {
    dateKey,
    todayKey: sudanDateKey(now),
    letterCount: WORD_LETTER_COUNT,
    maxAttempts: MAX_ATTEMPTS,
    startsAt: dayStartUtc(dateKey).toISOString(),
    endsAt: dayEndUtc(dateKey).toISOString(),
    msRemaining: Math.max(0, dayEndUtc(dateKey).getTime() - now.getTime()),
    appUrl: optionalEnv("APP_URL"),
    state,
  };
}

/** Everything the board needs before the first guess, and nothing that spoils it. */
export const getPuzzle = createServerFn({ method: "GET" }).handler(
  async (): Promise<PuzzlePayload> => {
    // Loading the game is the first request of a new container, and that is where
    // the daily reminder's ticker starts. Idempotent: after the first call it is
    // a property read. See `push-scheduler.ts` for why it is not a boot hook.
    startReminderScheduler();

    const now = new Date();
    const today = sudanDateKey(now);
    const resolution = await resolveDay(today);

    if (resolution.status === "ready") {
      return puzzlePayload(resolution.day.dateKey, "ready", now);
    }
    // Today, with nothing left to draw from: the pool has run dry.
    return puzzlePayload(today, "no-words", now);
  },
);

const guessInput = z.object({
  dateKey: z.string().max(10),
  // Generous enough for diacritics and dialect letters, small enough to refuse junk.
  guess: z.string().max(64),
  /** Guesses already made before this one. */
  attemptsSoFar: z
    .number()
    .int()
    .min(0)
    .max(MAX_ATTEMPTS - 1),
  /** The `progress` token from the previous guess; absent before the first. */
  progress: z.string().max(128).optional(),
});

/**
 * Marks one guess.
 *
 * The attempt count is what unlocks the answer, so the server does not take the
 * client's word for it: every count past zero must come with the token the
 * previous guess returned. That keeps the word off the wire while the game is
 * running without needing accounts to track player progress server-side.
 */
export const submitGuess = createServerFn({ method: "POST" })
  .validator(guessInput)
  .handler(async ({ data }): Promise<GuessPayload> => {
    const { dateKey, guess } = data;

    if (!isDateKey(dateKey)) {
      return { ok: false, reason: "bad-date", message: "تاريخ غير صالح" };
    }

    const today = sudanDateKey();
    if (dateKey !== today) {
      return {
        ok: false,
        reason: "wrong-day",
        message: "انتهى هذا اليوم. حدِّث الصفحة للعب كلمة اليوم الجديدة.",
      };
    }

    // Checked before anything touches the database.
    if (!isPlayableWord(guess)) {
      return {
        ok: false,
        reason: "bad-length",
        message: `الكلمة يجب أن تكون ${WORD_LETTER_COUNT} حروف عربية بالضبط`,
      };
    }

    const [resolution, settings, secret] = await Promise.all([
      resolveDay(dateKey),
      getSettings(),
      getGameSecret(),
    ]);

    if (!verifyProgress(secret, dateKey, data.attemptsSoFar, data.progress)) {
      return {
        ok: false,
        reason: "bad-progress",
        message: "تعذّر التحقق من محاولاتك السابقة، فبدأت اللعبة من جديد.",
      };
    }

    if (resolution.status !== "ready") {
      return {
        ok: false,
        reason: "no-words",
        message: "لا توجد كلمة لهذا اليوم. تواصل مع مشرف الموقع.",
      };
    }

    // One lookup serves two jobs: refusing a word the game does not know, and
    // collecting the words it does not know so the operator can review them.
    // Recorded whether or not enforcement is on, so the gap in the dictionary is
    // visible either way.
    if (!(await wordExists(guess))) {
      await recordUnknownWord(guess);
      if (settings.enforceDictionary) {
        return { ok: false, reason: "not-a-word", message: "هذه الكلمة غير موجودة في القاموس" };
      }
    }

    const answer = resolution.day.wordText;
    const states = scoreGuess(guess, answer);
    const letters = toWordLetters(guess).map((letter) => letter.display);
    const solved = states.every((state) => state === "correct");
    const attemptsUsed = data.attemptsSoFar + 1;
    const finished = solved || attemptsUsed >= MAX_ATTEMPTS;

    // The link is looked up now rather than stored on the day, so a page added
    // after the day was served still reaches the player.
    const revealed = finished ? await getWordByText(answer) : null;

    return {
      ok: true,
      states,
      letters,
      solved,
      finished,
      attemptsUsed,
      progress: signProgress(secret, dateKey, attemptsUsed),
      answer: finished ? answer : null,
      link: revealed?.link ?? null,
    };
  });
