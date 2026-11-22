/**
 * Old addresses the game has moved away from.
 *
 * Links to an old address are already out there, in chats and posts, and the
 * platforms that unfurl them should keep showing the same card. So on an old
 * host the game page is still served, with its social tags pointing at that old
 * host, and only a browser opening the page is sent on to `APP_URL`.
 *
 * Telling the two apart by user agent alone is not enough: WhatsApp's desktop
 * and web apps fetch previews with an ordinary browser's user agent. What a
 * preview fetch does not send is the `Sec-Fetch-Mode: navigate` and
 * `Sec-Fetch-Dest: document` pair every current browser attaches when it opens
 * a page. Those requests get a permanent redirect. Anything else gets the page
 * with a one-line script that forwards it: crawlers do not run scripts, and a
 * browser too old to send the headers still lands on the new address.
 *
 * Kept free of request objects so the decision can be tested on its own; the
 * server middleware only feeds it what the request carries.
 */

import { optionalEnv } from "./env.ts";

/**
 * The crawlers known to fetch a page to draw its card. They are served the
 * page as it is, without the forwarding script, in case one of them renders
 * pages in a real browser. Deliberately a list of preview fetchers rather than a
 * generic "bot" match: search engines should follow the redirect, so the index
 * moves to the new address.
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
  /** The `Sec-Fetch-Mode` and `Sec-Fetch-Dest` request headers. */
  fetchMode: string | null;
  fetchDest: string | null;
};

/**
 * What to do with a request on an old host:
 *
 * - `redirect`: a browser opening a page; answer with a 301 to `location`.
 * - `forward`: serve the page, with a script that sends a browser to `location`.
 * - null: serve it as usual.
 */
export type LegacyAction = { kind: "redirect" | "forward"; location: string } | null;

/**
 * Decides what a request that arrived on an old host gets; see `LegacyAction`.
 *
 * Only page loads are redirected. Files (the card image, icons, the service
 * worker, built assets) and the API stay reachable on the old host: the card
 * image is what the old previews point at, and players subscribed to the daily
 * notification on the old address still have a service worker there that
 * fetches its own script and reports to `/api/push`.
 */
export function legacyAction(
  request: LegacyRequest,
  options: { legacyHosts: readonly string[]; appUrl: string | null },
): LegacyAction {
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

  const location = `${target.origin}${request.pathname}${request.search}`;
  const opensPage = request.fetchMode === "navigate" && request.fetchDest === "document";
  return { kind: opensPage ? "redirect" : "forward", location };
}

/**
 * Adds the forwarding script to the top of a page's `<head>`, before anything
 * else loads. The fragment is not sent to the server, so the script appends it.
 * `location` carries the request's own path and query, so it is escaped to
 * stay inside the script.
 */
export function withForwardScript(html: string, location: string): string {
  const target = JSON.stringify(location).replace(/</g, "\\u003c");
  const script = `<script>location.replace(${target}+location.hash)</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return script + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + script + html.slice(at);
}
