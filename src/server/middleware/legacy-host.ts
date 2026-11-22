/**
 * Sends browsers on an old address to the current one; see `#/lib/legacy-host.ts`.
 *
 * Returns nothing for every request it leaves alone, which hands it on to the
 * rest of the app unchanged.
 */

import { defineMiddleware } from "nitro";

import { optionalEnv } from "#/lib/env.ts";
import { legacyAction, legacyHosts, requestHost, withForwardScript } from "#/lib/legacy-host.ts";

/**
 * The same address answers browsers and crawlers differently, so a cache in
 * front must neither store the answer nor hand one's answer to the other.
 */
const UNCACHEABLE = {
  vary: "user-agent, sec-fetch-mode, sec-fetch-dest",
  "cache-control": "no-store",
};

export default defineMiddleware(async (event, next) => {
  const legacy = legacyHosts();
  if (legacy.length === 0) return;

  const headers = event.req.headers;
  const action = legacyAction(
    {
      host: requestHost(headers),
      method: event.req.method,
      pathname: event.url.pathname,
      search: event.url.search,
      userAgent: headers.get("user-agent"),
      fetchMode: headers.get("sec-fetch-mode"),
      fetchDest: headers.get("sec-fetch-dest"),
    },
    { legacyHosts: legacy, appUrl: optionalEnv("APP_URL") },
  );
  if (!action) return;

  if (action.kind === "redirect") {
    return new Response(null, {
      status: 301,
      headers: { location: action.location, ...UNCACHEABLE },
    });
  }

  // Serve the page, so whatever fetched it reads the card, and forward a browser.
  const response = await next();
  if (
    !(response instanceof Response) ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    return response;
  }
  const html = withForwardScript(await response.text(), action.location);
  const forwarded = new Headers(response.headers);
  forwarded.delete("content-length");
  for (const [name, value] of Object.entries(UNCACHEABLE)) forwarded.set(name, value);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: forwarded,
  });
});
