import { useEffect, useState } from "react";

import { vapidKeyBytes } from "#/lib/reminder.ts";
import { getPushConfig, subscribeToReminders, unsubscribeFromReminders } from "#/server/push.ts";

/**
 * Asks the player whether they want a daily nudge.
 *
 * Only offered when the browser can actually do it and has not already been
 * asked. `Notification.permission` is one shot per site, so once it is denied
 * there is nothing to ask again — and a player who said "later" is remembered, so
 * the card does not follow them around every visit.
 *
 * Inline rather than a modal: it sits below the board and never interrupts a
 * game in progress.
 */

const DISMISS_KEY = "jradil:reminder-dismissed";
const DISMISS_DAYS = 7;

type State =
  | { kind: "checking" }
  /** Nothing to show: denied, dismissed, or already answered. */
  | { kind: "hidden" }
  | { kind: "unsupported" }
  /** iOS only honours push once the site is installed to the home screen. */
  | { kind: "needs-install" }
  /** The deployment has no VAPID keys, so there is nothing to subscribe to. */
  | { kind: "unavailable" }
  | { kind: "ready" }
  | { kind: "working" }
  | { kind: "subscribed" }
  | { kind: "error"; message: string };

const EXPLANATION: Record<string, string> = {
  unsupported: "متصفحك لا يدعم التنبيهات.",
  "needs-install":
    "على الآيفون، أضف الموقع إلى الشاشة الرئيسية من زر المشاركة ثم افتحه من هناك لتفعيل التنبيه.",
  unavailable: "التنبيهات غير مهيّأة على هذا الموقع بعد.",
  ready: "تنبيه واحد يوميًا عند الثالثة عصرًا بتوقيت السودان، حين تصدر كلمة اليوم الجديدة.",
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
    // A blocked storage only means the card may come back next visit.
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

export function ReminderPrompt() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function look() {
      if (!canPush()) {
        setState({ kind: isIOSWithoutInstall() ? "needs-install" : "unsupported" });
        return;
      }
      if (Notification.permission === "denied" || dismissedRecently()) {
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
        // Already subscribed here. Sending it again is a cheap upsert, and it
        // repairs the server side if its copy was ever lost.
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

  async function enable() {
    setState({ kind: "working" });
    try {
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
        applicationServerKey: vapidKeyBytes(publicKey),
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
  }

  async function disable() {
    setState({ kind: "working" });
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromReminders({ data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      rememberDismissal();
      setState({ kind: "hidden" });
    } catch {
      setState({ kind: "error", message: "تعذّر إيقاف التنبيه." });
    }
  }

  function dismiss() {
    rememberDismissal();
    setState({ kind: "hidden" });
  }

  if (state.kind === "checking" || state.kind === "hidden") return null;

  const actionable = state.kind === "ready" || state.kind === "working" || state.kind === "error";

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-3 p-4">
          {state.kind === "subscribed" ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">🔔 سيصلك تنبيه بكلمة اليوم كل يوم.</p>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => void disable()}>
                إيقاف
              </button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="font-bold">ذكّرني بكلمة اليوم</h2>
                <p className="text-base-content/70 mt-1 text-sm">
                  {state.kind === "error"
                    ? EXPLANATION.ready
                    : (EXPLANATION[state.kind] ?? EXPLANATION.ready)}
                </p>
              </div>

              {state.kind === "error" ? (
                <div role="alert" className="alert alert-error alert-soft py-2 text-xs">
                  <span>{state.message}</span>
                </div>
              ) : null}

              {actionable ? (
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={state.kind === "working"}
                    onClick={() => void enable()}
                  >
                    {state.kind === "working" ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : null}
                    تفعيل التنبيه
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
                    لاحقًا
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
