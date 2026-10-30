import { useEffect, useRef, useState, type ReactNode } from "react";

import { APP_NAME_AR, MAX_ATTEMPTS } from "#/lib/config.ts";
import type { GameRow, GameStatus } from "#/lib/game.ts";
import { buildShareText, deliverShareText } from "#/lib/share.ts";
import { shortDateKey, type DateKey } from "#/lib/sudan-time.ts";
import { isSafeExternalLink } from "#/lib/url.ts";

/**
 * The end-of-game panel: the answer, a way to learn about the word, and the
 * shareable grid.
 *
 * Built on the native `<dialog>` element so focus handling, Escape and the
 * backdrop come from the browser rather than from hand-written code.
 */
export function ResultDialog({
  open,
  dateKey,
  endsAt,
  appUrl,
  status,
  answer,
  link,
  rows,
  onClose,
  children,
}: {
  open: boolean;
  dateKey: DateKey;
  /** ISO instant the next word opens, so the shared countdown is live. */
  endsAt: string;
  /** Public address of this deployment, appended to the shared text. */
  appUrl: string | null;
  status: GameStatus;
  answer: string | null;
  link: string | null;
  rows: readonly GameRow[];
  onClose: () => void;
  /** Shown under the answer: what to do next, such as the notification offer. */
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const maxAttempts = MAX_ATTEMPTS;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The browser focuses the first control, which would otherwise be whatever
      // `children` put first — an Enter meant for sharing must not subscribe.
      shareRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const won = status === "won";

  async function share() {
    // Read the clock now rather than reusing the payload's figure, which was
    // taken when the page loaded and may be minutes stale by the time a player
    // finishes and shares.
    const msRemaining = Math.max(0, new Date(endsAt).getTime() - Date.now());

    const text = buildShareText({
      appName: APP_NAME_AR,
      dateLabel: shortDateKey(dateKey),
      attempts: rows.length,
      maxAttempts: maxAttempts,
      states: rows.map((row) => row.states),
      msRemaining,
      appUrl,
    });

    const outcome = await deliverShareText(text, {
      share: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
      canShare:
        typeof navigator.canShare === "function" ? (data) => navigator.canShare(data) : undefined,
      // A phone or tablet: no mouse to hover with. Desktop share sheets are a
      // detour for what is usually a paste into a chat, so desktops copy.
      touch: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
      copy: (value) => navigator.clipboard.writeText(value),
    });
    setCopied(outcome === "copied");
  }

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box text-center">
        <h3 className="text-xl font-bold">{won ? "أحسنت! 🎉" : "انتهت المحاولات"}</h3>
        <p className="text-base-content/60 mt-1 text-sm">{shortDateKey(dateKey)}</p>

        <div className="bg-base-200 rounded-box mt-4 p-5">
          <p className="text-base-content/60 text-sm">الكلمة كانت</p>
          <p className="mt-1 text-4xl font-bold tracking-widest">{answer ?? "—"}</p>

          {isSafeExternalLink(link) ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label="اقرأ معناها في قاموس اللهجة السودانية (يفتح في نافذة جديدة)"
              className="dictionary-link btn btn-secondary mt-4 h-auto w-full justify-between gap-3 py-3 text-start"
            >
              <span className="flex items-center gap-3">
                <svg
                  className="h-6 w-6 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 6.5C10.3 5.2 7.9 4.6 4 4.6v13.2c3.9 0 6.3.6 8 1.9 1.7-1.3 4.1-1.9 8-1.9V4.6c-3.9 0-6.3.6-8 1.9z" />
                  <path d="M12 6.5v13.2" />
                </svg>
                <span className="flex flex-col items-start gap-0.5 leading-tight">
                  <span className="text-base font-bold">اقرأ معناها</span>
                  <span className="text-xs font-normal">في قاموس اللهجة السودانية</span>
                </span>
              </span>
              <span aria-hidden="true" className="dictionary-link-arrow text-lg">
                ↗
              </span>
            </a>
          ) : null}
        </div>

        {children}

        <div className="modal-action">
          <button
            ref={shareRef}
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => void share()}
          >
            {copied ? "تم النسخ ✓" : "شارك نتيجتك"}
          </button>
          <form method="dialog" className="flex-1">
            <button className="btn w-full">إغلاق</button>
          </form>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button>إغلاق</button>
      </form>
    </dialog>
  );
}
