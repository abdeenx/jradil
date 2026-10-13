/**
 * Light/dark theme handling.
 *
 * The theme is applied by an attribute on `<html>` rather than by daisyUI's
 * `theme-controller`, for two reasons: the choice has to survive a reload, and
 * it has to be correct on the very first paint. An inline script in `<head>`
 * sets the attribute before the browser renders anything, and the toggle in the
 * header writes both the attribute and the stored preference.
 *
 * The key lives here so the script and the toggle cannot drift apart.
 */

export const THEME_STORAGE_KEY = "jradil:theme";

export type Theme = "light" | "dark";

/** Reads the theme currently applied to the document. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Applies a theme to the document and remembers it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or a blocked storage: the theme still applies for this page.
  }
}

/**
 * Runs before first paint.
 *
 * A stored choice wins. Otherwise the operating system's preference decides,
 * so a first visit already looks right — but it is never re-read afterwards, so
 * an explicit choice is never overridden.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=s==="dark"||s==="light"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
