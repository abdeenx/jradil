import { useState } from "react";

import { formatReminderTime, parseReminderTime, type ReminderTime } from "#/lib/reminder.ts";
import { adminUpdateSettings } from "#/server/admin.ts";

/**
 * The daily reminder's send time.
 *
 * A `<input type="time">` rather than two number fields: it is the control the
 * browser already has for a clock reading, it cannot produce an out-of-range
 * value, and it respects the operator's 12- or 24-hour preference.
 *
 * The time is Sudan local, which is the only clock the app uses — so the label
 * says so, because an operator working from another country would otherwise
 * reasonably read it as their own time.
 */
export function ReminderSettings({
  hour,
  minute,
  subscribers,
  onSaved,
}: {
  hour: number;
  minute: number;
  subscribers: number;
  onSaved: () => void;
}) {
  const saved: ReminderTime = { hour, minute };
  const [value, setValue] = useState(formatReminderTime(saved));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = parseReminderTime(value);
  const changed = parsed !== null && formatReminderTime(parsed) !== formatReminderTime(saved);

  async function save() {
    if (!parsed || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await adminUpdateSettings({
        data: { reminderHour: parsed.hour, reminderMinute: parsed.minute },
      });
      setNotice(`سيصل التنبيه الساعة ${formatReminderTime(parsed)} بتوقيت الخرطوم.`);
      onSaved();
    } catch {
      setNotice("تعذّر الحفظ. تحقق من الاتصال بقاعدة البيانات.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">التنبيه اليومي</h2>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">وقت الإرسال بتوقيت الخرطوم (UTC+2)</legend>
          <div className="join">
            <input
              type="time"
              className="input join-item w-36"
              value={value}
              disabled={busy}
              onChange={(event) => {
                setValue(event.target.value);
                setNotice(null);
              }}
            />
            <button
              type="button"
              className="btn join-item"
              disabled={busy || !changed}
              onClick={() => void save()}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : null}
              حفظ
            </button>
          </div>
          <p className="label">
            تنبيه واحد في اليوم لمن فعّله. يسري التغيير خلال دقيقة، ولا يحتاج إعادة نشر.
          </p>
        </fieldset>

        <p className="text-base-content/70 text-sm">
          المشتركون: <span className="font-bold">{subscribers}</span>
          {subscribers === 0 ? " — لم يفعّل أحد التنبيه بعد." : null}
        </p>

        {notice ? (
          <div role="alert" className="alert alert-info alert-soft py-2 text-sm">
            <span>{notice}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
