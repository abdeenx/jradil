import { Link } from "@tanstack/react-router";

import { Bucket } from "#/components/Bucket.tsx";
import { ThemeToggle } from "#/components/ThemeToggle.tsx";
import { WORDMARK_AR } from "#/lib/config.ts";

/**
 * The wordmark is the app's own board: one bucket per letter of the name, all
 * filled, so the brand reads as a solved row of the game rather than text sitting
 * beside a logo.
 *
 * It reuses the board's `Bucket` component outright, so the mark cannot drift
 * from what players actually look at — and it follows the theme for free, since
 * the buckets are painted from the same variables.
 */
const NAME_LETTERS = Array.from(WORDMARK_AR);

/**
 * Sized in one place. The letters inside a bucket occupy roughly 0.37 of its
 * height, so this is the number to turn if the wordmark needs to be bigger or
 * quieter in the bar. Roughly 160px wide as it stands.
 */
const BUCKET_SIZE = "h-8 w-auto";

/**
 * Top bar. The wordmark, optionally where you are, and the theme switch.
 *
 * There is no admin link here — almost every visitor is a player, and the
 * operator's way in belongs out of their way (see the footer of the game page).
 */
export function SiteHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="bg-base-100 border-base-300 border-b">
      <div className="navbar mx-auto max-w-4xl gap-2 px-3">
        <Link
          to="/"
          // The row is artwork, so the name is handed to assistive technology
          // whole rather than spelled out one bucket at a time.
          aria-label={WORDMARK_AR}
          className="shrink-0"
        >
          <span aria-hidden="true" className="flex items-center gap-0.5">
            {NAME_LETTERS.map((letter, index) => (
              <Bucket
                key={`${letter}-${index}`}
                letter={letter}
                result="correct"
                className={BUCKET_SIZE}
              />
            ))}
          </span>
        </Link>

        {subtitle ? (
          <span className="text-base-content/50 truncate text-sm">{subtitle}</span>
        ) : null}

        <div className="ms-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
