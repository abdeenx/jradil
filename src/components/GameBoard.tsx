import { useState } from "react";

import { Bucket } from "#/components/Bucket.tsx";
import { BUCKET_STAGGER_MS } from "#/lib/bucket.ts";
import type { GameRow } from "#/lib/game.ts";

/**
 * The guess grid.
 *
 * Columns run right to left because the document direction is RTL, which puts
 * the first letter of the word in the rightmost bucket — the way it is read.
 *
 * Only the row that has just been submitted animates. Rows restored from a
 * previous session render straight into their settled graphic, and the row being
 * typed has no water in it at all.
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
  // Derived during render rather than in an effect: the new row has to animate
  // from its very first frame, and an effect would let it paint once settled.
  const [seenCount, setSeenCount] = useState(rows.length);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);

  if (rows.length !== seenCount) {
    setRevealingRow(rows.length > seenCount ? rows.length - 1 : null);
    setSeenCount(rows.length);
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-1.5" role="group" aria-label="لوحة المحاولات">
      {Array.from({ length: maxAttempts }, (_, rowIndex) => {
        const row = rows[rowIndex];
        const isActive = rowIndex === rows.length;
        const letters = row ? row.letters : isActive ? current : [];
        const revealing = rowIndex === revealingRow;

        return (
          <div
            key={rowIndex}
            dir="rtl"
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${letterCount}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: letterCount }, (_, columnIndex) => (
              <Bucket
                key={columnIndex}
                className="h-auto w-full"
                letter={letters[columnIndex]}
                result={row?.states[columnIndex]}
                animate={revealing}
                stagger={columnIndex * BUCKET_STAGGER_MS}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
