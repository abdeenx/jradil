/**
 * Old addresses the game has moved away from.
 *
 * Links to an old address are already out there, in chats and posts, and the
 * platforms that unfurl them should keep showing the same card. So on an old
 * host the link-preview crawlers are still served the game page, with its
 * social tags pointing at that old host, while people in a browser are sent on
 * to `APP_URL` with a permanent redirect.
 *
 * Kept free of request objects so the decision can be tested on its own; the
 * server middleware only feeds it what the request carries.
 */

import { optionalEnv } from "./env.ts";

/**
 * The crawlers that fetch a page to draw its card. Deliberately a list of
 * preview fetchers rather than a generic "bot" match: search engines should
 * follow the redirect, so the index moves to the new address. A fetcher missing
 * from the list is not a disaster either — it follows the redirect and reads
 * the same card from the new address.
 */
const LINK_PREVIEW_AGENTS =
  /facebookexternalhit|facebookcatalog|facebot|meta-externalagent|twitterbot|whatsapp|telegrambot|slackbot|slack-imgproxy|discordbot|linkedinbot|skypeuripreview|microsoftpreview|pinterest|redditbot|embedly|iframely|snapchat|viber|vkshare|mastodon|bluesky|cardyb|google-pagerenderer/i;

export function isLinkPreviewAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && LINK_PREVIEW_AGENTS.test(userAgent));
}

/** A host as configured or as a request carries it: lower case, without a port. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Parses `LEGACY_HOSTS`: host names separated by commas or spaces. */
export function parseLegacyHosts(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => {
      // Accept a full address too, since that is what people tend to paste.
      try {
        return normalizeHost(entry.includes("://") ? new URL(entry).host : entry);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function legacyHosts(): string[] {
  return parseLegacyHosts(optionalEnv("LEGACY_HOSTS"));
}

/**
 * The host a request was addressed to. A proxy in front of the app may put the
 * original in `X-Forwarded-Host`; only the first entry is the client's.
 */
export function requestHost(headers: { get(name: string): string | null }): string | null {
  const host = headers.get("x-forwarded-host")?.split(",")[0] ?? headers.get("host");
  return host ? normalizeHost(host) : null;
}

/**
 * The old host this request came in on, or null when it came in on the
 * current one (or no old hosts are configured).
 */
export function matchLegacyHost(host: string | null, legacy: readonly string[]): string | null {
  if (!host) return null;
  const normalized = normalizeHost(host);
  return legacy.includes(normalized) ? normalized : null;
}

export type LegacyRequest = {
  host: string | null;
  method: string;
  pathname: string;
  search: string;
  userAgent: string | null;
};

/**
 * Where to send a request that arrived on an old host, or null to serve it as
 * usual.
 *
 * Only page loads are redirected. Files (the card image, icons, the service
 * worker, built assets) and the API stay reachable on the old host: the card
 * image is what the old previews point at, and players subscribed to the daily
 * notification on the old address still have a service worker there that
 * fetches its own script and reports to `/api/push`.
 */
export function legacyRedirect(
  request: LegacyRequest,
  options: { legacyHosts: readonly string[]; appUrl: string | null },
): string | null {
  if (!matchLegacyHost(request.host, options.legacyHosts)) return null;
  if (!options.appUrl) return null;

  let target: URL;
  try {
    target = new URL(options.appUrl);
  } catch {
    return null;
  }
  // Never loop: an old host that is also the configured address is just the site.
  if (matchLegacyHost(target.host, options.legacyHosts)) return null;

  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (request.pathname.startsWith("/api/") || request.pathname.startsWith("/_serverFn/")) {
    return null;
  }
  // A dot in the last segment is a file, not a page.
  if (request.pathname.split("/").at(-1)?.includes(".")) return null;
  if (isLinkPreviewAgent(request.userAgent)) return null;

  return `${target.origin}${request.pathname}${request.search}`;
}
