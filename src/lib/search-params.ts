/**
 * URL search-param parsing for the routes.
 *
 * Route `validateSearch` functions are part of the route tree, which ships in
 * the entry bundle every player downloads. These few lines stand in for a schema
 * library there, so the admin pages' parsing costs players nothing.
 */

/** The highest page the server functions accept. */
export const MAX_PAGE = 10_000;

/** A 1-based page number; anything malformed falls back to the first page. */
export function pageParam(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/** A free-text param, bounded to what the server will accept. */
export function textParam(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/** One of a fixed set of values, or the fallback. */
export function enumParam<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
