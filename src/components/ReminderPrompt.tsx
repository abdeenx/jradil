import { useEffect, useRef } from "react";

import type { Reminder, ReminderState } from "#/hooks/useReminder.ts";

/**
 * Two ways the same switch is offered.
 *
 * `ReminderDialog` is the prompt: a real `<dialog>` that interrupts, once the
 * game is over and the result panel is out of the way. `ReminderCard` is the
 * quiet path for anyone who waves the popup away, and the place to turn the
 * reminder off again afterwards.
 *
 * Both take the same `Reminder`, so there is one subscription state between them.
 */

const EXPLANATION: Record<string, string> = {
  unsupported: "متصفحك لا يدعم التنبيهات.",
  "needs-install":
    "على الآيفون، أضف الموقع إلى الشاشة الرئيسية من زر المشاركة ثم افتحه من هناك لتفعيل التنبيه.",
  unavailable: "التنبيهات غير مهيّأة على هذا الموقع بعد.",
  ready: "تنبيه واحد يوميًا حين تصدر كلمة اليوم الجديدة، بتوقيت الخرطوم.",
};

function explanationFor(state: ReminderState): string {
  return state.kind === "error"
    ? EXPLANATION.ready
    : (EXPLANATION[state.kind] ?? EXPLANATION.ready);
}

/** The enable button, shared so the two surfaces cannot drift apart. */
function EnableButton({ reminder, label }: { reminder: Reminder; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={reminder.state.kind === "working"}
      onClick={() => reminder.enable()}
    >
      {reminder.state.kind === "working" ? (
        <span className="loading loading-spinner loading-sm" />
      ) : null}
      {label}
    </button>
  );
}

/**
 * The passive offer: always available while the reminder is still on the table,
 * so dismissing the popup never leaves the player with no way back in.
 */
export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const { state } = reminder;
  if (state.kind === "checking" || state.kind === "hidden") return null;

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-3 p-4">
          {state.kind === "subscribed" ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">🔔 سيصلك تنبيه بكلمة اليوم كل يوم.</p>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => reminder.disable()}
              >
                إيقاف
              </button>
            </div>
          ) : (
            <>
              <div>
                <h2 className="font-bold">ذكّرني بكلمة اليوم</h2>
                <p className="text-base-content/70 mt-1 text-sm">{explanationFor(state)}</p>
              </div>

              {state.kind === "error" ? (
                <div role="alert" className="alert alert-error alert-soft py-2 text-xs">
                  <span>{state.message}</span>
                </div>
              ) : null}

              {state.kind === "ready" || state.kind === "working" || state.kind === "error" ? (
                <div className="card-actions">
                  <EnableButton reminder={reminder} label="تفعيل التنبيه" />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The prompt itself.
 *
 * `open` is the page's judgement that this is the moment — the dialog still
 * declines unless the browser can genuinely be asked, so the caller does not
 * have to know how the subscription works.
 *
 * Opens on a short delay rather than instantly: it is triggered by the result
 * panel closing, and swapping one dialog for another in the same frame reads as
 * a glitch rather than a prompt.
 */
export function ReminderDialog({ reminder, open }: { reminder: Reminder; open: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const wantsToAsk = open && reminder.state.kind === "ready" && !reminder.dismissed;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!wantsToAsk) {
      if (dialog.open) dialog.close();
      return;
    }

    const timer = window.setTimeout(() => {
      if (!dialog.open) dialog.showModal();
    }, 700);

    return () => window.clearTimeout(timer);
  }, [wantsToAsk]);

  const { state } = reminder;
  if (state.kind === "checking" || state.kind === "hidden" || state.kind === "subscribed") {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      // Escape and the backdrop both mean "not now", which is a dismissal.
      onClose={() => reminder.dismiss()}
    >
      <div className="modal-box text-center">
        <p className="text-4xl" aria-hidden="true">
          🔔
        </p>
        <h3 className="mt-2 text-xl font-bold">لا تفوّتك كلمة اليوم</h3>
        <p className="text-base-content/70 mt-2 text-sm">
          {state.kind === "ready" ? EXPLANATION.ready : explanationFor(state)}
        </p>

        {state.kind === "error" ? (
          <div role="alert" className="alert alert-error alert-soft mt-3 py-2 text-xs">
            <span>{state.message}</span>
          </div>
        ) : null}

        <div className="modal-action flex-col-reverse gap-2 sm:flex-row">
          {state.kind === "ready" || state.kind === "working" || state.kind === "error" ? (
            <EnableButton reminder={reminder} label="نعم، ذكّرني" />
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => dialogRef.current?.close()}
          >
            لاحقًا
          </button>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button>إغلاق</button>
      </form>
    </dialog>
  );
}
