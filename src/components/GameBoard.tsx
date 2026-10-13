import type { LetterState } from "#/lib/arabic.ts";
import type { GameRow } from "#/lib/game.ts";

function tileClass(state: LetterState | undefined, filled: boolean): string {
  if (state === "correct") return "border-success bg-success text-success-content";
  if (state === "present") return "border-warning bg-warning text-warning-content";
  if (state === "absent") return "border-base-300 bg-base-300 text-base-content/50";
  return filled ? "border-base-content/40 bg-base-100" : "border-base-300 bg-base-100";
}

/**
 * The guess grid.
 *
 * Columns run right to left because the document direction is RTL, which puts
 * the first letter of the word in the rightmost tile — the way it is read.
 */
export function GameBoard({
  rows,
  current,
  letterCount,
  maxAttempts,
}: {
  rows: readonly GameRow[];
  current: readonly string[];
  letterCount: number;
  maxAttempts: number;
}) {
  return (
    <div className="mx-auto w-full max-w-sm space-y-1.5" role="group" aria-label="لوحة المحاولات">
      {Array.from({ length: maxAttempts }, (_, rowIndex) => {
        const row = rows[rowIndex];
        const isActive = rowIndex === rows.length;
        const letters = row ? row.letters : isActive ? current : [];

        return (
          <div
            key={rowIndex}
            dir="rtl"
            className={`grid gap-1.5 ${row ? "animate-pop" : ""}`}
            style={{ gridTemplateColumns: `repeat(${letterCount}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: letterCount }, (_, columnIndex) => {
              const letter = letters[columnIndex];
              const state = row?.states[columnIndex];
              return (
                <div
                  key={columnIndex}
                  className={`flex aspect-square items-center justify-center rounded-md border-2 text-3xl leading-none font-bold ${tileClass(
                    state,
                    Boolean(letter),
                  )} ${letter && !row ? "animate-rise" : ""}`}
                >
                  {letter ?? ""}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
