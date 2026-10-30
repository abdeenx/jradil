import { Bucket } from "#/components/Bucket.tsx";
import { isBaseLetter, KEYPAD_ROWS, type LetterState } from "#/lib/arabic.ts";

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
 * Rows follow the Windows Arabic (101) layout, mirrored right to left, so the
 * letters sit where a PC keyboard user expects them. The few Windows keys that
 * are not playable letters stay visible but disabled, so the shape of the
 * keyboard still reads correctly.
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
      {KEYPAD_ROWS.map((row) => (
        <div key={row.join("")} className="flex justify-center">
          <div
            dir="rtl"
            className="flex gap-0.5 sm:gap-1"
            style={{ width: `${(row.length / COLUMNS) * 100}%` }}
          >
            {row.map((letter) => {
              const playable = isBaseLetter(letter);

              return (
                <button
                  key={letter}
                  type="button"
                  disabled={disabled || !playable}
                  aria-label={
                    playable ? `الحرف ${letter}` : `${letter} — حرف لا يدخل في كلمات اللعبة`
                  }
                  title={playable ? undefined : "يُطوى هذا الحرف إلى حرف أساسي، فلا يُستخدم هنا"}
                  onClick={() => onLetter(letter)}
                  className={`flex h-12 min-w-0 flex-1 items-center justify-center rounded-md transition-colors ${
                    playable
                      ? "hover:bg-base-200 active:bg-base-300 disabled:opacity-60"
                      : "cursor-not-allowed"
                  }`}
                >
                  {playable ? (
                    <Bucket letter={letter} result={keyStates[letter]} className="h-11 w-full" />
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
          </div>
        </div>
      ))}

      <div dir="rtl" className="flex gap-0.5 sm:gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={onEnter}
          className="btn btn-primary h-12 flex-[2] font-bold"
        >
          إدخال
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onBackspace}
          aria-label="حذف حرف"
          className="btn h-12 flex-[2] font-bold"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
