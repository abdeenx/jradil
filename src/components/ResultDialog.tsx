import { useEffect, useRef, useState } from "react";

import { APP_NAME_AR, MAX_ATTEMPTS } from "#/lib/config.ts";
import type { GameRow, GameStatus } from "#/lib/game.ts";
import { buildShareText } from "#/lib/share.ts";
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
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const maxAttempts = MAX_ATTEMPTS;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
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

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
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
              className="btn btn-ghost btn-sm mt-3 gap-1"
            >
              اقرأ عن الكلمة
              <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-primary flex-1" onClick={() => void share()}>
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
