import type { PushSubscriptionControl } from "#/hooks/usePushSubscription.ts";

/**
 * Two places the daily notification is offered.
 *
 * `NotificationOffer` is the prompt. It lives in the result panel, which opens
 * by itself when a game ends — the moment the offer means something, because
 * the word it promises is tomorrow's — and it never interrupts a game in
 * progress or stacks a second dialog on the first.
 *
 * `NotificationToggle` is the quiet way back: a line in the footer, so turning
 * the offer down is never a dead end, and the place to switch it off again.
 */

function Spinner() {
  return <span className="loading loading-spinner loading-xs" aria-hidden="true" />;
}

export function NotificationOffer({
  push,
  enabled,
}: {
  push: PushSubscriptionControl;
  /** The operator has the daily notification switched on. */
  enabled: boolean;
}) {
  if (!enabled) return null;
  const { state } = push;

  if (state === "on") {
    return (
      <p className="text-success mt-4 text-sm" role="status">
        🔔 سيصلك تنبيه حين تصدر الكلمة الجديدة كل يوم.
      </p>
    );
  }

  if (push.dismissed) return null;

  if (state === "needs-install") {
    return (
      <div className="border-base-300 rounded-box mt-4 border p-4 text-start">
        <p className="font-bold">🔔 تنبيه بكلمة اليوم على الآيفون</p>
        <p className="text-base-content/70 mt-1 text-sm">
          اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح جرادل من هناك لتفعيل التنبيه.
        </p>
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={push.dismiss}>
          حسنًا
        </button>
      </div>
    );
  }

  if (state !== "off" && state !== "working") return null;

  return (
    <div className="border-base-300 rounded-box mt-4 border p-4 text-start">
      <p className="font-bold">🔔 ذكّرني بكلمة الغد</p>
      <p className="text-base-content/70 mt-1 text-sm">
        تنبيه واحد في اليوم حين تكون الكلمة الجديدة جاهزة. يمكنك إيقافه متى شئت.
      </p>
      {push.error ? <p className="text-error mt-2 text-xs">{push.error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={state === "working"}
          onClick={() => void push.subscribe()}
        >
          {state === "working" ? <Spinner /> : null}
          نعم، ذكّرني
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={state === "working"}
          onClick={push.dismiss}
        >
          لا، شكرًا
        </button>
      </div>
    </div>
  );
}

export function NotificationToggle({
  push,
  enabled,
}: {
  push: PushSubscriptionControl;
  enabled: boolean;
}) {
  const { state } = push;

  // Someone already subscribed can always switch it off, even while the
  // operator has the notification paused.
  if (state === "on" || (state === "working" && push.endpoint)) {
    return (
      <p className="text-base-content/50 text-xs">
        🔔 التنبيه اليومي مفعّل ·{" "}
        <button
          type="button"
          className="link"
          disabled={state === "working"}
          onClick={() => void push.unsubscribe()}
        >
          إيقاف
        </button>
      </p>
    );
  }

  if (!enabled) return null;

  if (state === "off" || state === "working") {
    return (
      <p className="text-base-content/50 text-xs">
        <button
          type="button"
          className="link"
          disabled={state === "working"}
          onClick={() => void push.subscribe()}
        >
          🔔 ذكّرني بكلمة اليوم كل يوم
        </button>
        {push.error ? <span className="text-error block">{push.error}</span> : null}
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-base-content/40 text-xs">
        التنبيهات محظورة لهذا الموقع. يمكن السماح بها من إعدادات المتصفح.
      </p>
    );
  }

  return null;
}
