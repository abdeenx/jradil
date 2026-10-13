import { useEffect, useState } from "react";

import { applyTheme, currentTheme } from "#/lib/theme.ts";

/**
 * Light/dark switch.
 *
 * The chosen theme is already on `<html>` before this mounts, so the checkbox
 * starts unchecked and syncs in an effect. That keeps the server and client
 * markup identical during hydration — the visible theme never waits for React.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => setDark(currentTheme() === "dark"), []);

  return (
    <label
      className="swap swap-rotate hover:bg-base-200 h-9 w-9 shrink-0 rounded-full"
      title={dark ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي"}
    >
      <input
        type="checkbox"
        checked={dark}
        aria-label="الوضع الليلي"
        onChange={(event) => {
          const next = event.target.checked;
          setDark(next);
          applyTheme(next ? "dark" : "light");
        }}
      />

      {/* Shown while the light theme is active. */}
      <svg
        className="swap-off h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" />
      </svg>

      {/* Shown while the dark theme is active. */}
      <svg
        className="swap-on h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </label>
  );
}
