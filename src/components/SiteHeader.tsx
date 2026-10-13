import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/ThemeToggle.tsx";
import { APP_NAME_AR } from "#/lib/config.ts";

/**
 * Top bar. The name, optionally where you are, and the theme switch.
 *
 * There is no admin link here — almost every visitor is a player, and the
 * operator's way in belongs out of their way (see the footer of the game page).
 */
export function SiteHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="bg-base-100 border-base-300 border-b">
      <div className="navbar mx-auto max-w-4xl gap-2 px-3">
        <Link to="/" className="text-xl font-bold tracking-tight">
          {APP_NAME_AR}
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
