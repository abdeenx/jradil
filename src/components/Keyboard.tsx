import { Bucket } from "#/components/Bucket.tsx";
import { foldLetter, KEYPAD_ROWS, type LetterState } from "#/lib/arabic.ts";

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
 * Rows follow Gboard's Arabic layout, minus its `ء ؤ ى` keys: laid out left to
 * right as on the phone with `ض` in the top-left corner, and backspace closing
 * the last letter row on the right. `ة` is typed as shown and folded by the game, so it
 * shares the state of `ه`.
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
            {/* A phone keyboard is not mirrored for Arabic, so neither is this one. */}
            <div
              dir="ltr"
              className="flex gap-0.5 sm:gap-1"
              style={{ width: `${(keys / COLUMNS) * 100}%` }}
            >
              {row.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  disabled={disabled}
                  aria-label={`الحرف ${letter}`}
                  onClick={() => onLetter(letter)}
                  className="hover:bg-base-200 active:bg-base-300 flex h-12 min-w-0 flex-1 items-center justify-center rounded-md transition-colors disabled:opacity-60"
                >
                  <Bucket
                    letter={letter}
                    result={keyStates[foldLetter(letter)]}
                    className="h-11 w-full"
                  />
                </button>
              ))}

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
