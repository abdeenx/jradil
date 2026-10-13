import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { toLetters } from "#/lib/arabic.ts";
import { WORD_LETTER_COUNT } from "#/lib/config.ts";
import { shortDateKey, type DateKey } from "#/lib/sudan-time.ts";
import { adminListWords, adminPreviewWord, adminSetDayWord } from "#/server/admin.ts";

type Preview = {
  found: boolean;
  dialect: boolean;
  /** Set when this word has already had a day of its own. */
  usedOn: string | null;
  timesServed: number;
} | null;
type Notice = { tone: "error" | "success" | "warning"; text: string };

// Static class names, because Tailwind cannot see a template literal.
const NOTICE_CLASS: Record<Notice["tone"], string> = {
  error: "alert-error",
  success: "alert-success",
  warning: "alert-warning",
};

/**
 * Picks the word for a single Sudan day.
 *
 * The operator can type any word or choose one of the available candidates. A
 * debounced lookup explains the state of what they typed *before* they commit:
 * already in the dictionary, flagged as Sudanese dialect, or brand new.
 */
export function WordPicker({
  dateKey,
  heading,
  onDone,
}: {
  dateKey: DateKey;
  heading?: string;
  /** Called after a successful save, so a parent can collapse the picker. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  /** The word the operator is being asked to confirm serving a second time. */
  const [repeatConfirm, setRepeatConfirm] = useState<string | null>(null);

  const trimmed = text.trim();
  const letterCount = useMemo(() => toLetters(trimmed).length, [trimmed]);
  const wellFormed = letterCount === WORD_LETTER_COUNT;

  // Available candidates double as autocomplete entries and as a random pick source.
  useEffect(() => {
    let cancelled = false;
    void adminListWords({ data: { pool: true, served: false, pageSize: 200 } })
      .then((result) => {
        if (!cancelled) setSuggestions(result.items.map((item) => item.text));
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced lookup so the operator sees the word's state while typing.
  useEffect(() => {
    if (!wellFormed) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      void adminPreviewWord({ data: { text: trimmed } })
        .then((result) => {
          if (cancelled) return;
          if (!result.found) {
            setPreview({ found: false, dialect: false, usedOn: null, timesServed: 0 });
            return;
          }
          // A word already booked for *this* day is not a repeat of an old day.
          const usedOn =
            result.found.lastServedDateKey && result.found.lastServedDateKey !== dateKey
              ? result.found.lastServedDateKey
              : null;
          setPreview({
            found: true,
            dialect: result.found.dialect,
            usedOn,
            timesServed: result.found.timesServed,
          });
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, wellFormed, dateKey]);

  async function save(options: {
    createIfMissing?: boolean;
    allowNonDialect?: boolean;
    allowRepeat?: boolean;
  }) {
    if (busy || !wellFormed) return;
    setBusy(true);
    setNotice(null);

    try {
      const result = await adminSetDayWord({
        data: { dateKey, text: trimmed, ...options },
      });

      if (result.ok) {
        setNotice({ tone: "success", text: `تم تعيين «${result.value.wordText}» لهذا اليوم.` });
        setText("");
        setPreview(null);
        await router.invalidate();
        onDone?.();
        return;
      }

      // The server refuses a repeat until it is confirmed; turn that into a
      // warning with a confirm action rather than a dead end.
      if (result.code === "already-used") {
        setRepeatConfirm(trimmed);
        setNotice({ tone: "warning", text: result.reason });
        return;
      }

      setNotice({ tone: "error", text: result.reason });
    } catch {
      setNotice({ tone: "error", text: "تعذّر الحفظ. تحقق من الاتصال بقاعدة البيانات." });
    } finally {
      setBusy(false);
    }
  }

  function pickRandom() {
    if (suggestions.length === 0) return;
    const next = suggestions[Math.floor(Math.random() * suggestions.length)];
    setText(next);
    setNotice(null);
    setRepeatConfirm(null);
  }

  const listId = `word-suggestions-${dateKey}`;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-bold">{heading ?? "اختيار كلمة"}</h3>
        <p className="text-base-content/60 text-sm">{shortDateKey(dateKey)}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grow">
          <span className="sr-only">الكلمة</span>
          <input
            list={listId}
            className="input w-full text-lg font-bold tracking-widest"
            value={text}
            dir="rtl"
            placeholder={`${WORD_LETTER_COUNT} حروف`}
            onChange={(event) => {
              setText(event.target.value);
              setNotice(null);
              setRepeatConfirm(null);
            }}
          />
        </label>

        <button
          type="button"
          className="btn"
          onClick={pickRandom}
          disabled={suggestions.length === 0}
          title="اختيار عشوائي من المرشحين المتاحين"
        >
          عشوائي
        </button>

        <button
          type="button"
          className={`btn ${preview?.usedOn ? "btn-warning" : "btn-primary"}`}
          disabled={busy || !wellFormed}
          onClick={() => {
            // Warn first, so a repeat is never one careless click away.
            if (preview?.usedOn) {
              setRepeatConfirm(trimmed);
              setNotice({
                tone: "warning",
                text:
                  preview.timesServed > 1
                    ? `«${trimmed}» سبق أن كانت كلمة اليوم ${preview.timesServed} مرات، آخرها ${preview.usedOn}.`
                    : `«${trimmed}» سبق أن كانت كلمة اليوم بتاريخ ${preview.usedOn}.`,
              });
              return;
            }
            void save({});
          }}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          تعيين
        </button>
      </div>

      <datalist id={listId}>
        {suggestions.map((word) => (
          <option key={word} value={word} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`badge badge-sm ${wellFormed ? "badge-ghost" : "badge-warning"}`}>
          {letterCount} / {WORD_LETTER_COUNT} حروف
        </span>

        {checking ? (
          <span className="text-base-content/50">جارٍ التحقق…</span>
        ) : preview === null ? null : preview.found ? (
          <>
            <span className="badge badge-success badge-sm">موجودة في القاموس</span>
            {preview.usedOn ? (
              <span className="badge badge-warning badge-sm" title="سبق أن كانت كلمة اليوم">
                استُخدمت سابقًا · {preview.usedOn}
              </span>
            ) : null}
            {preview.dialect ? (
              <span className="badge badge-success badge-sm">كلمة سودانية</span>
            ) : (
              <>
                <span className="badge badge-warning badge-sm">غير معلَّمة كسودانية</span>
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={busy}
                  onClick={() => void save({ allowNonDialect: true })}
                >
                  اقبلها كما هي
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <span className="badge badge-warning badge-sm">غير موجودة في القاموس</span>
            <button
              type="button"
              className="btn btn-xs"
              disabled={busy}
              onClick={() => void save({ createIfMissing: true })}
            >
              أضفها وعلّمها سودانية
            </button>
          </>
        )}
      </div>

      {suggestions.length === 0 ? (
        <p className="text-base-content/60 text-xs">
          لا توجد كلمات متاحة في قائمة الاختيار التلقائي. أضف كلمات سودانية من صفحة «الكلمات»، أو
          استخدم زر «أكمل القائمة» في اللوحة.
        </p>
      ) : null}

      {notice ? (
        <div role="alert" className={`alert alert-soft py-2 text-sm ${NOTICE_CLASS[notice.tone]}`}>
          <span>{notice.text}</span>
          {repeatConfirm ? (
            <button
              type="button"
              className="btn btn-warning btn-sm"
              disabled={busy}
              onClick={() => {
                setRepeatConfirm(null);
                void save({ allowRepeat: true });
              }}
            >
              أكّد الإعادة
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
