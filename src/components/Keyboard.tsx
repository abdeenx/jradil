import { Bucket } from "#/components/Bucket.tsx";
import { foldLetter, isTypableLetter, KEYPAD_ROWS, type LetterState } from "#/lib/arabic.ts";

/** The widest row decides the key size; the short rows are centred under it. */
const COLUMNS = Math.max(...KEYPAD_ROWS.map((row) => row.length));

/**
 * On-screen keypad.
 *
 * Every letter key is the same bucket as the board, drawn at key size. A key
 * starts empty and settles into the same three graphics as the board as its
 * best-known state improves — the CSS in `styles.css` delays those
 * transitions so the keys follow the board's reveal rather than race it.
 *
 * Rows follow Gboard's Arabic layout, with backspace closing the last letter
 * row as it does on a phone. Keys like `ة` and `ى` are typed as shown and
 * folded by the game, so each one shares the state of the letter it folds onto.
 * `ء` folds onto nothing, so it stays visible but disabled to keep the layout's
 * shape.
 */
export function Keyboard({
  keyStates,
  disabled,
  onLetter,
  onBackspace,
  onEnter,
}: {
  keyStates: Record<string, LetterState>;
  disabled: boolean;
  onLetter: (letter: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-1.5">
      {KEYPAD_ROWS.map((row, rowIndex) => {
        const hasBackspace = rowIndex === KEYPAD_ROWS.length - 1;
        const keys = row.length + (hasBackspace ? 1 : 0);

        return (
          <div key={row.join("")} className="flex justify-center">
            <div
              dir="rtl"
              className="flex gap-0.5 sm:gap-1"
              style={{ width: `${(keys / COLUMNS) * 100}%` }}
            >
              {row.map((letter) => {
                const playable = isTypableLetter(letter);

                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={disabled || !playable}
                    aria-label={
                      playable ? `الحرف ${letter}` : `${letter} — حرف لا يدخل في كلمات اللعبة`
                    }
                    title={playable ? undefined : "لا تحتوي كلمات اللعبة على هذا الحرف"}
                    onClick={() => onLetter(letter)}
                    className={`flex h-12 min-w-0 flex-1 items-center justify-center rounded-md transition-colors ${
                      playable
                        ? "hover:bg-base-200 active:bg-base-300 disabled:opacity-60"
                        : "cursor-not-allowed"
                    }`}
                  >
                    {playable ? (
                      <Bucket
                        letter={letter}
                        result={keyStates[foldLetter(letter)]}
                        className="h-11 w-full"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="text-base-content/25 flex h-11 w-full items-center justify-center text-sm leading-none font-bold"
                      >
                        {letter}
                      </span>
                    )}
                  </button>
                );
              })}

              {hasBackspace ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onBackspace}
                  aria-label="حذف حرف"
                  className="btn h-12 min-w-0 flex-1 px-0 font-bold"
                >
                  ⌫
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        disabled={disabled}
        onClick={onEnter}
        className="btn btn-primary h-12 w-full font-bold"
      >
        إدخال
      </button>
    </div>
  );
}
