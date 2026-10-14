/**
 * Sends the daily reminder on request.
 *
 * The app already sends it by itself — `push-scheduler.ts` ticks inside the
 * server process — so nothing needs to call this. It exists for the case where
 * the container is not guaranteed to be running at 15:00 Khartoum, and the
 * operator would rather drive it from a scheduler they control:
 *
 *     curl -X POST "https://your-host/api/cron/reminder?secret=$CRON_SECRET"
 *
 * Safe to call at any time. It decides for itself whether the reminder is due,
 * and records the day it sent for, so a cron that fires twice sends once.
 *
 * Protect it with `CRON_SECRET` (query `?secret=` or header `x-cron-secret`).
 * Without that variable it falls back to requiring an admin session.
 */

import { createFileRoute } from "@tanstack/react-router";

import { readSession } from "#/lib/admin-auth.ts";
import { optionalEnv } from "#/lib/env.ts";
import { runReminder } from "#/lib/push.ts";

export const Route = createFileRoute("/api/cron/reminder")({
  server: {
    handlers: {
      // Without this the path falls through to the page renderer and answers 200
      // with an empty document, which reads as "endpoint is fine" to a monitor
      // and as a page to a crawler.
      GET: () => Response.json({ ok: false, message: "use POST" }, { status: 405 }),

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const provided = url.searchParams.get("secret") ?? request.headers.get("x-cron-secret");
        const expected = optionalEnv("CRON_SECRET");

        const authorised = expected ? provided === expected : readSession().authenticated;
        if (!authorised) {
          return Response.json({ ok: false, message: "unauthorized" }, { status: 401 });
        }

        try {
          return Response.json({ ok: true, ...(await runReminder()) });
        } catch (error) {
          return Response.json({ ok: false, message: (error as Error).message }, { status: 500 });
        }
      },
    },
  },
});
