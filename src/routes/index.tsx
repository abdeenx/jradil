import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { Bucket } from "#/components/Bucket.tsx";
import { Confetti } from "#/components/Confetti.tsx";
import { Countdown } from "#/components/Countdown.tsx";
import { GameBoard } from "#/components/GameBoard.tsx";
import { Keyboard } from "#/components/Keyboard.tsx";
import { ResultDialog } from "#/components/ResultDialog.tsx";
import { SiteHeader } from "#/components/SiteHeader.tsx";
import { useDailyGame } from "#/hooks/useDailyGame.ts";
import { isBaseLetter, toLetters } from "#/lib/arabic.ts";
import { APP_NAME_AR, NEXT_WORD_LABEL, TAGLINE_AR } from "#/lib/config.ts";
import { socialMeta } from "#/lib/social.ts";
import { shortDateKey } from "#/lib/sudan-time.ts";
import { getPuzzle } from "#/server/puzzle.ts";

export const Route = createFileRoute("/")({
  loader: () => getPuzzle(),
  /**
   * Social cards belong to the game page, which is what people share, rather
   * than to the admin screens behind it.
   *
   * The address comes from the loader, so it is absolute without a second
   * mechanism for reading the environment, and identical on the server and in
   * the browser — the tags a crawler reads are the ones rendered here.
   */
  head: ({ loaderData }) => ({ meta: socialMeta(loaderData?.appUrl ?? null) }),
  component: GamePage,
});

function GamePage() {
  const puzzle = Route.useLoaderData();
  const router = useRouter();
  const game = useDailyGame(puzzle);

  const handleElapsed = useCallback(() => {
    void router.invalidate();
  }, [router]);

  // The game object is new on every render; the listener reads the latest one
  // through a ref so it is attached once rather than on every keystroke.
  const gameRef = useRef(game);
  gameRef.current = game;

  // Physical keyboard support: Arabic letters, Enter and Backspace.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const game = gameRef.current;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (game.status !== "playing" || game.resultOpen) return;

      if (event.key === "Enter") {
        event.preventDefault();
        game.commit();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        game.popLetter();
        return;
      }

      const letters = toLetters(event.key);
      if (letters.length === 1 && isBaseLetter(letters[0])) {
        event.preventDefault();
        game.pushLetter(letters[0]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const playable = puzzle.state === "ready";

  return (
    <>
      <SiteHeader subtitle={TAGLINE_AR} />

      <main className="mx-auto w-full max-w-4xl px-3 pt-5 pb-6">
        {/* The one line of chrome the board needs: which day, and how long is left. */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <h1 className="text-base font-bold">{shortDateKey(puzzle.dateKey)}</h1>
          <Countdown
            msRemaining={puzzle.msRemaining}
            label={NEXT_WORD_LABEL}
            onElapsed={handleElapsed}
          />
        </div>

        {playable ? (
          <div className="space-y-5">
            <GameBoard
              rows={game.rows}
              current={game.current}
              letterCount={puzzle.letterCount}
              maxAttempts={puzzle.maxAttempts}
            />

            <div className="flex min-h-6 items-center justify-center">
              {game.message ? (
                <div
                  role="alert"
                  className="alert alert-error alert-soft animate-rise py-2 text-sm"
                >
                  <span>{game.message}</span>
                </div>
              ) : null}
            </div>

            <Keyboard
              keyStates={game.keyStates}
              disabled={game.status !== "playing" || game.busy}
              onLetter={game.pushLetter}
              onBackspace={game.popLetter}
              onEnter={game.commit}
            />

            {game.status !== "playing" ? (
              <div className="text-center">
                <button type="button" className="btn btn-outline btn-sm" onClick={game.openResult}>
                  عرض النتيجة
                </button>
              </div>
            ) : null}

            {/* Teaches the colours once, then gets out of the way. */}
            {game.rows.length === 0 ? <Legend /> : null}
          </div>
        ) : (
          <div className="mx-auto max-w-md">
            <div role="alert" className="alert alert-warning alert-vertical text-center">
              <h2 className="text-lg font-bold">لا توجد كلمة لهذا اليوم</h2>
              <p className="text-sm">
                لم تُعيَّن كلمة لليوم، ولم تتبقَّ كلمات في قائمة الاختيار التلقائي. عُد لاحقًا.
              </p>
            </div>
          </div>
        )}

        <footer className="text-base-content/40 mt-8 text-center text-xs">
          {APP_NAME_AR} — كلمة سودانية جديدة كل يوم، بتوقيت الخرطوم (UTC+2).
        </footer>
      </main>

      <ResultDialog
        open={game.resultOpen}
        dateKey={puzzle.dateKey}
        endsAt={puzzle.endsAt}
        appUrl={puzzle.appUrl}
        status={game.status}
        answer={game.answer}
        link={game.link}
        rows={game.rows}
        onClose={game.closeResult}
      />

      {/* After the dialog on purpose: its effect opens second, so it stacks on top. */}
      <Confetti burst={game.celebration} />
    </>
  );
}

/**
 * Teaches the three bucket graphics, and disappears once the first guess is in.
 * The examples are the real component, so the legend can never fall out of step
 * with what the board actually draws.
 */
function Legend() {
  const items = [
    { letter: "ع", result: "correct" as const, label: "الحرف في مكانه الصحيح" },
    { letter: "س", result: "present" as const, label: "الحرف موجود في مكان آخر" },
    { letter: "ل", result: "absent" as const, label: "الحرف غير موجود" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2 text-xs sm:flex-row sm:justify-between">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <Bucket letter={item.letter} result={item.result} className="h-10 w-8 shrink-0" />
          <span className="text-base-content/70">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
