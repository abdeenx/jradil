/**
 * External links the operator attaches to a word, so a player who finishes the
 * puzzle can go and read more about it.
 *
 * Only `http` and `https` are accepted. A stored value is rendered straight into
 * an `href`, so anything else — `javascript:`, `data:` — must never survive
 * validation.
 */

export function normalizeExternalLink(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A link that is safe to put in an `href`. */
export function isSafeExternalLink(value: string | null | undefined): value is string {
  return normalizeExternalLink(value) !== null;
}
