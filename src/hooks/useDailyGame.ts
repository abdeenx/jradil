/**
 * Daily game state.
 *
 * Progress lives in `localStorage` rather than the database. That is a
 * deliberate scope decision: the server only needs to know which word belongs
 * to which day, and a player's own rows are theirs. It also means the game
 * needs no accounts, no sessions and no writes from the public at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { keypadStates, type LetterState } from "#/lib/arabic.ts";
import type { GameRow, GameStatus } from "#/lib/game.ts";
import { submitGuess, type PuzzlePayload } from "#/server/puzzle.ts";

const STORAGE_KEY = "jradil:daily:v1";

export type { GameRow, GameStatus };

type StoredGame = {
  dateKey: string;
  rows: GameRow[];
  status: GameStatus;
  answer: string | null;
  /** Kept so the reveal survives a page reload without asking the server again. */
  link: string | null;
};

function emptyGame(dateKey: string): StoredGame {
  return { dateKey, rows: [], status: "playing", answer: null, link: null };
}

function readStored(dateKey: string): StoredGame {
  if (typeof window === "undefined") return emptyGame(dateKey);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyGame(dateKey);
    const parsed = JSON.parse(raw) as Partial<StoredGame>;
    // Progress belongs to one day only: a new puzzle starts from scratch.
    if (parsed.dateKey !== dateKey || !Array.isArray(parsed.rows)) return emptyGame(dateKey);
    return {
      dateKey,
      rows: parsed.rows as GameRow[],
      status: parsed.status === "won" || parsed.status === "lost" ? parsed.status : "playing",
      answer: typeof parsed.answer === "string" ? parsed.answer : null,
      link: typeof parsed.link === "string" ? parsed.link : null,
    };
  } catch {
    return emptyGame(dateKey);
  }
}

export type DailyGame = {
  rows: GameRow[];
  current: string[];
  status: GameStatus;
  answer: string | null;
  link: string | null;
  message: string | null;
  busy: boolean;
  keyStates: Record<string, LetterState>;
  /** Board row currently accepting letters, or -1 when the game is over. */
  activeRow: number;
  pushLetter: (letter: string) => void;
  popLetter: () => void;
  commit: () => void;
  dismissMessage: () => void;
  resultOpen: boolean;
  openResult: () => void;
  closeResult: () => void;
};

export function useDailyGame(puzzle: PuzzlePayload): DailyGame {
  const [game, setGame] = useState<StoredGame>(() => emptyGame(puzzle.dateKey));
  const [current, setCurrent] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const busyRef = useRef(false);

  // Restore (or start) the day's progress once running in the browser.
  useEffect(() => {
    setGame(readStored(puzzle.dateKey));
    setCurrent([]);
    setMessage(null);
    setResultOpen(false);
  }, [puzzle.dateKey]);

  const persist = useCallback((next: StoredGame) => {
    setGame(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked storage should not break the game.
    }
  }, []);

  const playable = puzzle.state === "ready";
  const activeRow = game.status === "playing" && playable ? game.rows.length : -1;

  const pushLetter = useCallback(
    (letter: string) => {
      if (activeRow < 0) return;
      setCurrent((previous) =>
        previous.length >= puzzle.letterCount ? previous : [...previous, letter],
      );
    },
    [activeRow, puzzle.letterCount],
  );

  const popLetter = useCallback(() => {
    if (activeRow < 0) return;
    setCurrent((previous) => previous.slice(0, -1));
  }, [activeRow]);

  const dismissMessage = useCallback(() => setMessage(null), []);

  const commit = useCallback(() => {
    if (activeRow < 0 || busyRef.current) return;

    if (current.length !== puzzle.letterCount) {
      setMessage(`الكلمة يجب أن تكون ${puzzle.letterCount} حروف`);
      return;
    }

    const guess = current.join("");
    busyRef.current = true;
    setBusy(true);

    void submitGuess({
      data: {
        dateKey: puzzle.dateKey,
        guess,
        attemptsSoFar: game.rows.length,
      },
    })
      .then((result) => {
        if (!result.ok) {
          setMessage(result.message);
          return;
        }

        const rows: GameRow[] = [...game.rows, { letters: result.letters, states: result.states }];
        const status: GameStatus = result.solved ? "won" : result.finished ? "lost" : "playing";

        persist({
          dateKey: puzzle.dateKey,
          rows,
          status,
          answer: result.answer,
          link: result.link,
        });
        setCurrent([]);
        if (status !== "playing") setResultOpen(true);
      })
      .catch(() => {
        setMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [activeRow, current, game.rows, persist, puzzle.dateKey, puzzle.letterCount]);

  // Auto-clear the transient hint.
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [message]);

  const keyStates = useMemo(() => keypadStates(game.rows), [game.rows]);

  return {
    rows: game.rows,
    current,
    status: game.status,
    answer: game.answer,
    link: game.link,
    message,
    busy,
    keyStates,
    activeRow,
    pushLetter,
    popLetter,
    commit,
    dismissMessage,
    resultOpen,
    openResult: () => setResultOpen(true),
    closeResult: () => setResultOpen(false),
  };
}
