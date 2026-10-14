/**
 * This browser's push subscription: what it can do, whether it is on, and the
 * switch.
 *
 * One instance per page, passed to every surface that shows the switch, so they
 * cannot disagree about whether it is on.
 *
 * Nothing is registered until the player asks: the service worker is installed
 * by `subscribe`, not on page load, so a visitor who never wants notifications
 * never gets one.
 */

import { useCallback, useEffect, useState } from "react";

import { base64UrlToBytes, sameKey } from "#/lib/notifications.ts";

export type PushState =
  | "checking"
  /** No service worker, push or notification support at all. */
  | "unsupported"
  /** iOS: push exists only for a site added to the home screen. */
  | "needs-install"
  /** The player refused at the browser's prompt; only the browser can undo it. */
  | "denied"
  | "off"
  | "on"
  | "working";

export type PushSubscriptionControl = {
  state: PushState;
  /** This browser's endpoint while subscribed — the admin test sends to it. */
  endpoint: string | null;
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  /** True when the player has turned the offer down recently. */
  dismissed: boolean;
  dismiss: () => void;
};

const DISMISS_KEY = "jradil:push-offer-dismissed";
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

/** The server's copy is refreshed this often, which also catches a key change. */
const SYNC_KEY = "jradil:push-synced";
const SYNC_MS = 7 * 24 * 60 * 60 * 1000;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage only means the offer or the sync may come round sooner.
  }
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIOS(): boolean {
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function installed(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

async function fetchPublicKey(): Promise<string> {
  const response = await fetch("/api/push");
  if (!response.ok) throw new Error(`push config ${response.status}`);
  return ((await response.json()) as { publicKey: string }).publicKey;
}

/** Hands a subscription to the server; returns the key the server signs with. */
async function register(subscription: PushSubscription): Promise<string> {
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error(`subscribe ${response.status}`);
  writeStorage(SYNC_KEY, `${Date.now()}`);
  return ((await response.json()) as { publicKey: string }).publicKey;
}

async function subscribeWith(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    // Required: every push must end in a visible notification.
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
}

/**
 * Re-sends a live subscription now and then. That repairs the server's copy if
 * it was ever lost, and if the server's key changed, swaps the subscription for
 * one made with the new key — permission is already granted, so no prompt.
 */
async function resync(
  registration: ServiceWorkerRegistration,
  subscription: PushSubscription,
): Promise<PushSubscription> {
  const last = Number(readStorage(SYNC_KEY) ?? 0);
  if (Date.now() - last < SYNC_MS) return subscription;

  const publicKey = await register(subscription);
  if (sameKey(subscription.options.applicationServerKey, publicKey)) return subscription;

  await subscription.unsubscribe();
  const replacement = await subscribeWith(registration, publicKey);
  await register(replacement);
  return replacement;
}

export function usePushSubscription(): PushSubscriptionControl {
  const [state, setState] = useState<PushState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(Date.now() - Number(readStorage(DISMISS_KEY) ?? 0) < DISMISS_MS);

    async function look() {
      if (!supported()) {
        setState(isIOS() && !installed() ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/");
      let subscription = (await registration?.pushManager.getSubscription()) ?? null;
      if (registration && subscription) {
        subscription = await resync(registration, subscription).catch(() => subscription);
      }
      if (cancelled) return;

      setEndpoint(subscription?.endpoint ?? null);
      setState(subscription && Notification.permission === "granted" ? "on" : "off");
    }

    void look().catch(() => {
      if (!cancelled) setState("off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    setState("working");
    try {
      // First, while the tap that called this still counts as a user gesture:
      // Safari will not show the prompt otherwise.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      // `subscribe` needs an active worker, not just a registered one.
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const publicKey = await fetchPublicKey();

      let subscription = existing;
      if (!subscription || !sameKey(subscription.options.applicationServerKey, publicKey)) {
        await subscription?.unsubscribe();
        subscription = await subscribeWith(registration, publicKey);
      }

      try {
        await register(subscription);
      } catch (cause) {
        // A subscription the server never heard of would look "on" and stay silent.
        await subscription.unsubscribe();
        throw cause;
      }

      setEndpoint(subscription.endpoint);
      setState("on");
    } catch {
      setError("تعذّر تفعيل التنبيهات على هذا المتصفح. حاول مرة أخرى لاحقًا.");
      setState("off");
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // The server is told first: once unsubscribed locally, the endpoint is lost.
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      writeStorage(SYNC_KEY, null);
      setEndpoint(null);
      setState("off");
    } catch {
      setError("تعذّر إيقاف التنبيهات. حاول مرة أخرى.");
      setState("on");
    }
  }, []);

  const dismiss = useCallback(() => {
    writeStorage(DISMISS_KEY, `${Date.now()}`);
    setDismissed(true);
  }, []);

  return { state, endpoint, error, subscribe, unsubscribe, dismiss, dismissed };
}
