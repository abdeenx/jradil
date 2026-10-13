import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Countdown } from "#/components/Countdown.tsx";
import { GameBoard } from "#/components/GameBoard.tsx";
import { Keyboard } from "#/components/Keyboard.tsx";
import { ResultDialog } from "#/components/ResultDialog.tsx";
import { SiteHeader } from "#/components/SiteHeader.tsx";
import { useDailyGame } from "#/hooks/useDailyGame.ts";
import { isBaseLetter, toLetters } from "#/lib/arabic.ts";
import { APP_NAME_AR } from "#/lib/config.ts";
import { shortDateKey } from "#/lib/sudan-time.ts";
import { getPuzzle } from "#/server/puzzle.ts";

export const Route = createFileRoute("/")({
  loader: () => getPuzzle(),
  component: GamePage,
});

function GamePage() {
  const puzzle = Route.useLoaderData();
  const router = useRouter();
  const game = useDailyGame(puzzle);

  const handleElapsed = useCallback(() => {
    void router.invalidate();
  }, [router]);

  // Physical keyboard support: Arabic letters, Enter and Backspace.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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
  }, [game]);

  const playable = puzzle.state === "ready";

  return (
    <>
      <SiteHeader subtitle="كلمة سودانية جديدة كل يوم" />

      <main className="mx-auto w-full max-w-4xl px-3 pt-5 pb-6">
        {/* The one line of chrome the board needs: which day, and how long is left. */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <h1 className="text-base font-bold">{shortDateKey(puzzle.dateKey)}</h1>
          <Countdown
            msRemaining={puzzle.msRemaining}
            endsAt={puzzle.endsAt}
            label="الكلمة القادمة بعد"
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

        <footer className="text-base-content/40 mt-8 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span>{APP_NAME_AR} — كلمة واحدة كل يوم، بتوقيت السودان (UTC+2).</span>
          <Link to="/admin" className="hover:text-base-content/70 underline">
            لوحة المشرف
          </Link>
        </footer>
      </main>

      <ResultDialog
        open={game.resultOpen}
        dateKey={puzzle.dateKey}
        status={game.status}
        answer={game.answer}
        link={game.link}
        rows={game.rows}
        onClose={game.closeResult}
      />
    </>
  );
}

/** Explains the three tile colours, for the first guess only. */
function Legend() {
  const items = [
    { className: "bg-success text-success-content", label: "الحرف في مكانه الصحيح" },
    { className: "bg-warning text-warning-content", label: "الحرف موجود في مكان آخر" },
    { className: "bg-base-300 text-base-content/50", label: "الحرف غير موجود" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-1.5 text-xs sm:flex-row sm:justify-between">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={`h-5 w-5 shrink-0 rounded border ${item.className}`} />
          <span className="text-base-content/70">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
