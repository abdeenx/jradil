import { useEffect, useRef, useState } from "react";

import type { WordView } from "#/lib/words.ts";
import { adminUpdateWord } from "#/server/admin.ts";

/**
 * Edits the operator-supplied metadata for one word.
 *
 * `link` is the payoff for the player: it is what the result panel shows once
 * the puzzle is over, so a word can teach something after it is guessed.
 */
export function WordEditDialog({
  word,
  onClose,
  onSaved,
}: {
  word: WordView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!word) return;
    setLink(word.link ?? "");
    setNotes(word.notes ?? "");
    setError(null);
  }, [word]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (word && !dialog.open) dialog.showModal();
    if (!word && dialog.open) dialog.close();
  }, [word]);

  async function save() {
    if (!word || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminUpdateWord({
        data: { id: word.id, link: link.trim() || null, notes: notes.trim() || null },
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("تعذّر الحفظ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box">
        <h3 className="text-lg font-bold">
          تعديل بيانات <span className="tracking-widest">{word?.text}</span>
        </h3>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">رابط للتعريف بالكلمة</legend>
          <input
            type="url"
            dir="ltr"
            className="input w-full"
            placeholder="https://ar.wiktionary.org/wiki/…"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <p className="label">
            يظهر للاعب بعد انتهاء الجولة كزر «اقرأ عن الكلمة». تُقبل روابط http و https فقط.
          </p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">ملاحظات</legend>
          <textarea
            className="textarea w-full"
            rows={2}
            placeholder="ملاحظة لنفسك، لا تظهر للاعبين"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </fieldset>

        {error ? (
          <div role="alert" className="alert alert-error alert-soft py-2 text-sm">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="modal-action">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : null}
            حفظ
          </button>
          <form method="dialog">
            <button className="btn btn-ghost">إلغاء</button>
          </form>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button>إغلاق</button>
      </form>
    </dialog>
  );
}
