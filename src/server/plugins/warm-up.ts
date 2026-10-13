/**
 * Renders the game page once as the server starts.
 *
 * The first request after a deploy otherwise pays for everything at once:
 * loading the server bundle, opening the MongoDB connection, building indexes
 * and resolving the day — several seconds in all. Link-preview crawlers
 * (WhatsApp, Facebook, X) give up well before that, so a link shared just
 * after a deploy would show a bare card with no title or image.
 *
 * It goes through the app's own request pipeline rather than importing the
 * data layer, so it warms the exact modules and connection that real requests
 * use. Fire and forget: a failure here (say, the database still starting)
 * changes nothing — the next real request simply does the work instead.
 */

import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  setTimeout(() => {
    void Promise.resolve(nitroApp.fetch(new Request("http://localhost/")))
      .then((response) => response.arrayBuffer())
      .catch((error: unknown) => console.warn("[jradil] تعذّر تسخين الخادم عند البدء:", error));
  }, 0);
});
