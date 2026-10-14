import { useCallback, useEffect, useState } from "react";

import { getPushConfig, subscribeToReminders, unsubscribeFromReminders } from "#/server/push.ts";

/**
 * Browser push subscription state, shared by the card and the popup.
 *
 * One instance per page, owned by the page and passed to both: they are two
 * presentations of the same switch, and two instances would mean registering the
 * service worker and checking the config twice.
 *
 * Inline rather than a modal: it sits below the board and never interrupts a
 * game in progress.
 */

const DISMISS_KEY = "jradil:reminder-dismissed";
const DISMISS_DAYS = 7;

export type ReminderState =
  | { kind: "checking" }
  /** Nothing worth showing: the browser cannot do it, or it is already on. */
  | { kind: "hidden" }
  | { kind: "unsupported" }
  /** iOS only honours push once the site is installed to the home screen. */
  | { kind: "needs-install" }
  /** The deployment has no VAPID keys, so there is nothing to subscribe to. */
  | { kind: "unavailable" }
  /** The browser can ask, and has not. The only state worth prompting about. */
  | { kind: "ready" }
  | { kind: "working" }
  | { kind: "subscribed" }
  | { kind: "error"; message: string };

export type Reminder = {
  state: ReminderState;
  /** True once the player has waved the popup away recently. */
  dismissed: boolean;
  enable: () => void;
  disable: () => void;
  /** Stops the popup asking again for a while. The card stays available. */
  dismiss: () => void;
};

function dismissedRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // A blocked storage only means the popup may return next visit.
  }
}

function canPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iOS exposes the APIs but only delivers push to an installed site. */
function isIOSWithoutInstall(): boolean {
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iOS && !installed;
}

/** The VAPID key arrives base64url; `subscribe` wants bytes. */
function base64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}

export function useReminder(): Reminder {
  const [state, setState] = useState<ReminderState>({ kind: "checking" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(dismissedRecently());

    async function look() {
      if (!canPush()) {
        setState({ kind: isIOSWithoutInstall() ? "needs-install" : "unsupported" });
        return;
      }
      if (Notification.permission === "denied") {
        setState({ kind: "hidden" });
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (cancelled) return;

      const { publicKey } = await getPushConfig();
      if (cancelled) return;

      if (!publicKey) {
        setState({ kind: "unavailable" });
        return;
      }

      if (existing) {
        // Sending it again is a cheap upsert, and it repairs the server side if
        // its copy was ever lost.
        const json = existing.toJSON();
        await subscribeToReminders({
          data: {
            endpoint: existing.endpoint,
            keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
          },
        }).catch(() => undefined);
        if (!cancelled) setState({ kind: "subscribed" });
        return;
      }

      setState({ kind: "ready" });
    }

    void look().catch(() => setState({ kind: "unavailable" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setState({ kind: "working" });
    try {
      // Must follow a user gesture, which is why this is only ever called from a
      // button.
      if ((await Notification.requestPermission()) !== "granted") {
        // The browser will not ask again, so there is nothing left to offer.
        setState({ kind: "hidden" });
        return;
      }

      const { publicKey } = await getPushConfig();
      if (!publicKey) {
        setState({ kind: "unavailable" });
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        // Required everywhere: a push must result in something visible.
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(publicKey),
      });
      const json = subscription.toJSON();

      const result = await subscribeToReminders({
        data: {
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        },
      });

      setState(result.ok ? { kind: "subscribed" } : { kind: "error", message: result.reason });
    } catch {
      setState({ kind: "error", message: "تعذّر تفعيل التنبيه على هذا المتصفح." });
    }
  }, []);

  const disable = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromReminders({ data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      rememberDismissal();
      setDismissed(true);
      setState({ kind: "hidden" });
    } catch {
      setState({ kind: "error", message: "تعذّر إيقاف التنبيه." });
    }
  }, []);

  const dismiss = useCallback(() => {
    rememberDismissal();
    setDismissed(true);
  }, []);

  return { state, dismissed, enable, disable, dismiss };
}
