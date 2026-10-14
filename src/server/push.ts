/**
 * The client-facing side of the daily reminder.
 *
 * Deliberately unauthenticated: subscribing needs no account, and the VAPID
 * public key is public by design — it is the browser-side half of the pair. The
 * private key never leaves `push.ts`, which is server-only.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  pushPublicKey,
  removeSubscription,
  saveSubscription,
  type PushConfig,
} from "#/lib/push.ts";

/** What the browser needs before it can subscribe. */
export const getPushConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PushConfig> => ({ publicKey: pushPublicKey() }),
);

const subscriptionInput = z.object({
  endpoint: z.string().min(1).max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export const subscribeToReminders = createServerFn({ method: "POST" })
  .validator(subscriptionInput)
  .handler(async ({ data }) => saveSubscription(data));

export const unsubscribeFromReminders = createServerFn({ method: "POST" })
  .validator(z.object({ endpoint: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => removeSubscription(data.endpoint));
