import { KEYPAD_ROWS, type KeyState } from "#/lib/arabic.ts";

function keyClass(state: KeyState | undefined): string {
  if (state === "correct") return "btn-success";
  if (state === "present") return "btn-warning";
  if (state === "absent") return "btn-neutral";
  return "";
}

/**
 * On-screen keypad.
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
  keyStates: Record<string, KeyState>;
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
              className={`btn h-12 min-w-0 flex-1 px-0 text-lg font-bold ${keyClass(
                keyStates[letter],
              )}`}
            >
              {letter}
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
