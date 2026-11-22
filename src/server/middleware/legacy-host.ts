/**
 * Sends browsers on an old address to the current one; see `#/lib/legacy-host.ts`.
 *
 * Returns nothing for every request it lets through, which hands it on to the
 * rest of the app unchanged.
 */

import { defineHandler } from "nitro";

import { optionalEnv } from "#/lib/env.ts";
import { legacyHosts, legacyRedirect, requestHost } from "#/lib/legacy-host.ts";

export default defineHandler((event) => {
  const legacy = legacyHosts();
  if (legacy.length === 0) return;

  const headers = event.req.headers;
  const location = legacyRedirect(
    {
      host: requestHost(headers),
      method: event.req.method,
      pathname: event.url.pathname,
      search: event.url.search,
      userAgent: headers.get("user-agent"),
    },
    { legacyHosts: legacy, appUrl: optionalEnv("APP_URL") },
  );
  if (!location) return;

  return new Response(null, {
    status: 301,
    headers: {
      location,
      // The same address answers crawlers and browsers differently, so a cache
      // in front must not hand one's answer to the other.
      vary: "user-agent",
      "cache-control": "no-store",
    },
  });
});
