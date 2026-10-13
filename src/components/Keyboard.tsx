import { Bucket } from "#/components/Bucket.tsx";
import { KEYPAD_ROWS, type LetterState } from "#/lib/arabic.ts";

/**
 * On-screen keypad.
 *
 * Every letter key is the same bucket as the board, drawn at key size. A key
 * starts empty and settles into the same three graphics as the board as its
 * best-known state improves — the CSS in `styles.css` delays those
 * transitions so the keys follow the board's reveal rather than race it.
 *
 * Rows follow the familiar Arabic keyboard order and run right to left, so the
 * most used letters sit where a Sudanese keyboard user expects them.
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
        <div key={row.join("")} dir="rtl" className="flex gap-1">
          {row.map((letter) => (
            <button
              key={letter}
              type="button"
              disabled={disabled}
              aria-label={`الحرف ${letter}`}
              onClick={() => onLetter(letter)}
              className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-md transition-colors hover:bg-base-200 active:bg-base-300 disabled:opacity-60"
            >
              <Bucket letter={letter} result={keyStates[letter]} className="h-11 w-full" />
            </button>
          ))}
        </div>
      ))}

      <div dir="rtl" className="flex gap-1">
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
