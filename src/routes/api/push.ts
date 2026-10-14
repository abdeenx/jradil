/**
 * The players' side of the daily notification.
 *
 *     GET    /api/push   → { publicKey }           the key a browser subscribes with
 *     POST   /api/push   { endpoint, keys }        subscribe, or refresh a subscription
 *     DELETE /api/push   { endpoint }              unsubscribe
 *
 * A plain route rather than server functions because the service worker calls
 * it too, when the browser replaces a subscription on its own — and a service
 * worker cannot know the generated address of a server function.
 *
 * Deliberately unauthenticated: subscribing needs no account. What keeps it
 * honest is in `push.ts` and `notifications.ts` — only real push-service
 * endpoints are stored, and the store has a ceiling.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { isPushEndpoint } from "#/lib/notifications.ts";
import { pushPublicKey, removeSubscription, saveSubscription } from "#/lib/push.ts";

const endpoint = z.string().min(1).max(2000);

const subscribeInput = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

const unsubscribeInput = z.object({ endpoint });

/**
 * Browsers label every request with where it came from. Only this site's own
 * pages and its service worker have any business here.
 */
function crossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function fail(status: number, reason: string): Response {
  return Response.json({ ok: false, reason }, { status });
}

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      GET: async () => Response.json({ publicKey: await pushPublicKey() }),

      POST: async ({ request }) => {
        if (crossSite(request)) return fail(403, "cross-site");
        const parsed = subscribeInput.safeParse(await readJson(request));
        if (!parsed.success) return fail(400, "bad-input");

        const result = await saveSubscription(parsed.data);
        return result.ok ? Response.json(result) : fail(400, result.reason);
      },

      DELETE: async ({ request }) => {
        if (crossSite(request)) return fail(403, "cross-site");
        const parsed = unsubscribeInput.safeParse(await readJson(request));
        if (!parsed.success || !isPushEndpoint(parsed.data.endpoint)) return fail(400, "bad-input");

        await removeSubscription(parsed.data.endpoint);
        return Response.json({ ok: true });
      },
    },
  },
});
