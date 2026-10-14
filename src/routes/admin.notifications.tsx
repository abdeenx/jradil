import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { usePushSubscription, type PushSubscriptionControl } from "#/hooks/usePushSubscription.ts";
import {
  DEFAULT_NOTIFY_BODY,
  DEFAULT_NOTIFY_TITLE,
  LATE_WINDOW_MINUTES,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  formatNotifyTime,
  parseNotifyTime,
  scheduleStatus,
  type NotificationSettings,
} from "#/lib/notifications.ts";
import { formatSudan } from "#/lib/sudan-time.ts";
import {
  adminBroadcastNotification,
  adminGetNotifications,
  adminSendTestNotification,
  adminUpdateNotifications,
} from "#/server/admin.ts";

export const Route = createFileRoute("/admin/notifications")({
  loader: () => adminGetNotifications(),
  component: NotificationsPage,
});

/** The form's own copy of the settings; text fields hold "" for "use the default". */
type Draft = { enabled: boolean; time: string; title: string; body: string };

function toDraft(settings: NotificationSettings): Draft {
  return {
    enabled: settings.enabled,
    time: formatNotifyTime(settings.time),
    title: settings.title ?? "",
    body: settings.body ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.enabled === b.enabled &&
    a.time === b.time &&
    a.title.trim() === b.title.trim() &&
    a.body.trim() === b.body.trim()
  );
}

function NotificationsPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const push = usePushSubscription();

  const saved = toDraft(data.settings);
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const time = parseNotifyTime(draft.time);
  const changed = !sameDraft(draft, saved);

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(null);
  }

  async function save() {
    if (!time || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await adminUpdateNotifications({
        data: {
          enabled: draft.enabled,
          time: draft.time,
          title: draft.title.trim() || null,
          body: draft.body.trim() || null,
        },
      });
      if (!result.ok) {
        setNotice({ tone: "error", text: "وقت غير صالح." });
        return;
      }
      setDraft(toDraft(result.settings));
      setNotice({
        tone: "info",
        text: result.settings.enabled
          ? `حُفظ. يُرسل التنبيه يوميًا الساعة ${formatNotifyTime(result.settings.time)} بتوقيت الخرطوم.`
          : "حُفظ. التنبيه اليومي متوقف.",
      });
      await router.invalidate();
    } catch {
      setNotice({ tone: "error", text: "تعذّر الحفظ. تحقق من الاتصال بقاعدة البيانات." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------ settings -- */}
      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="card-title">التنبيه اليومي</h1>
            <label className="label cursor-pointer gap-2">
              <span className="text-sm">{draft.enabled ? "مفعّل" : "متوقف"}</span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={draft.enabled}
                onChange={(event) => edit({ enabled: event.target.checked })}
              />
            </label>
          </div>

          <p className="text-base-content/60 text-sm">
            تنبيه واحد في اليوم يصل إلى كل من فعّل التنبيهات في متصفحه، ليخبره أن كلمة اليوم جاهزة.
            إيقافه لا يلغي اشتراك أحد، ويمنع عرض دعوة الاشتراك على اللاعبين.
          </p>

          <fieldset className="fieldset" disabled={!draft.enabled}>
            <legend className="fieldset-legend">وقت الإرسال بتوقيت الخرطوم (UTC+2)</legend>
            <input
              type="time"
              className="input w-36"
              value={draft.time}
              onChange={(event) => edit({ time: event.target.value })}
            />
            <p className="label whitespace-normal">
              إن كان الخادم متوقفًا في هذا الوقت، يُرسل التنبيه حين يعود خلال{" "}
              {LATE_WINDOW_MINUTES / 60} ساعات، وإلا يُترك ذلك اليوم.
            </p>
          </fieldset>

          <fieldset className="fieldset" disabled={!draft.enabled}>
            <legend className="fieldset-legend">العنوان</legend>
            <input
              type="text"
              className="input w-full"
              maxLength={NOTIFY_TITLE_MAX}
              placeholder={DEFAULT_NOTIFY_TITLE}
              value={draft.title}
              onChange={(event) => edit({ title: event.target.value })}
            />
            <legend className="fieldset-legend">النص</legend>
            <textarea
              className="textarea w-full"
              rows={2}
              maxLength={NOTIFY_BODY_MAX}
              placeholder={DEFAULT_NOTIFY_BODY}
              value={draft.body}
              onChange={(event) => edit({ body: event.target.value })}
            />
            <p className="label">اترك الحقل فارغًا لاستخدام النص الافتراضي الظاهر فيه.</p>
          </fieldset>

          <Preview title={draft.title} body={draft.body} />

          {notice ? (
            <div
              role="alert"
              className={`alert alert-soft py-2 text-sm ${notice.tone === "error" ? "alert-error" : "alert-info"}`}
            >
              <span>{notice.text}</span>
            </div>
          ) : null}

          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !changed || !time}
              onClick={() => void save()}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : null}
              حفظ
            </button>
            {changed ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(saved);
                  setNotice(null);
                }}
              >
                تراجع
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- status -- */}
      <Status />

      {/* ------------------------------------------------------ send now -- */}
      <SendNow push={push} />

      {/* ---------------------------------------------------------- test -- */}
      <TestOnThisDevice push={push} title={draft.title} body={draft.body} />
    </div>
  );
}

/** Roughly how a phone shows it, so the operator can judge the length. */
function Preview({
  title,
  body,
  fallbackTitle = DEFAULT_NOTIFY_TITLE,
  fallbackBody = DEFAULT_NOTIFY_BODY,
}: {
  title: string;
  body: string;
  /** Shown while a field is blank. */
  fallbackTitle?: string;
  fallbackBody?: string;
}) {
  return (
    <div>
      <p className="text-base-content/60 mb-1 text-xs">معاينة</p>
      <div className="bg-base-200 rounded-box flex max-w-sm items-start gap-3 p-3 shadow-sm">
        <img src="/icon-192.png" alt="" className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title.trim() || fallbackTitle}</p>
          <p className="text-base-content/70 line-clamp-2 text-sm">{body.trim() || fallbackBody}</p>
        </div>
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  disabled: "متوقف، فلن يُرسل شيء.",
  sent: "أُرسل تنبيه اليوم.",
  upcoming: "سيُرسل اليوم في موعده.",
  sending: "حان موعده، ويُرسل خلال دقيقة.",
  missed: "فات موعد اليوم دون إرسال. التالي غدًا.",
} as const;

function Status() {
  const { settings, subscribers, lastRun } = Route.useLoaderData();
  const status = scheduleStatus(new Date(), settings, lastRun?.dateKey ?? null);

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">الحالة</h2>

        <div className="stats stats-vertical sm:stats-horizontal bg-base-200">
          <div className="stat">
            <div className="stat-title">المشتركون</div>
            <div className="stat-value text-2xl">{subscribers.toLocaleString("en-US")}</div>
            <div className="stat-desc">متصفح فعّل التنبيهات</div>
          </div>
          <div className="stat">
            <div className="stat-title">اليوم</div>
            <div className="stat-value text-base whitespace-normal">{STATUS_TEXT[status]}</div>
            <div className="stat-desc">الموعد {formatNotifyTime(settings.time)} بتوقيت الخرطوم</div>
          </div>
        </div>

        {lastRun ? (
          <p className="text-base-content/70 text-sm">
            آخر إرسال:{" "}
            {formatSudan(new Date(lastRun.at), { dateStyle: "medium", timeStyle: "short" })} · وصل
            إلى {lastRun.delivered} · تعذّر {lastRun.failed} · حُذف {lastRun.removed} اشتراكًا منتهيًا
          </p>
        ) : (
          <p className="text-base-content/60 text-sm">لم يُرسل أي تنبيه يومي بعد.</p>
        )}
      </div>
    </section>
  );
}

/**
 * A message of the operator's choosing, to every subscriber, now — for news
 * that does not fit the daily notification.
 *
 * Two steps on purpose: it reaches everyone and cannot be recalled, so the
 * button first asks, in place, with the number of people it will reach. The
 * server refuses a second send for a minute after one, so a double click or a
 * second tab cannot send it twice either.
 */
function SendNow({ push }: { push: PushSubscriptionControl }) {
  const { subscribers, lastBroadcast } = Route.useLoaderData();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"send" | "test" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const ready = title.trim() !== "" && body.trim() !== "";
  const canTest = push.state === "on" && push.endpoint !== null;

  function edit(update: () => void) {
    update();
    setConfirming(false);
    setNotice(null);
  }

  async function send() {
    setBusy("send");
    setNotice(null);
    try {
      const result = await adminBroadcastNotification({ data: { title, body } });
      if (result.ok) {
        setTitle("");
        setBody("");
        setNotice({
          tone: "success",
          text: `أُرسل. وصل إلى ${result.delivered} · تعذّر ${result.failed} · حُذف ${result.removed} اشتراكًا منتهيًا.`,
        });
        await router.invalidate();
      } else if (result.reason === "busy") {
        setNotice({
          tone: "error",
          text: `أُرسل تنبيه قبل قليل. انتظر ${result.retryInSeconds} ثانية ثم حاول مجددًا.`,
        });
      } else {
        setNotice({ tone: "error", text: "لا يوجد مشتركون بعد." });
      }
    } catch {
      setNotice({ tone: "error", text: "تعذّر الإرسال. تحقق من الاتصال بقاعدة البيانات." });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  async function test() {
    if (!push.endpoint) return;
    setBusy("test");
    setNotice(null);
    try {
      const outcome = await adminSendTestNotification({
        data: { endpoint: push.endpoint, title: title.trim(), body: body.trim() },
      });
      setNotice(
        outcome.ok
          ? { tone: "success", text: "أُرسلت التجربة إلى هذا الجهاز وحده." }
          : { tone: "error", text: TEST_FAILURE[outcome.reason] },
      );
    } catch {
      setNotice({ tone: "error", text: "تعذّر الإرسال." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-4">
        <div>
          <h2 className="card-title text-base">إرسال تنبيه الآن</h2>
          <p className="text-base-content/60 mt-1 text-sm">
            رسالة تكتبها أنت، تصل فورًا إلى كل المشتركين. مستقلة عن التنبيه اليومي: لا تُحسب مكانه،
            وتُرسل ولو كان متوقفًا.
          </p>
        </div>

        <fieldset className="fieldset" disabled={busy !== null}>
          <legend className="fieldset-legend">العنوان</legend>
          <input
            type="text"
            className="input w-full"
            maxLength={NOTIFY_TITLE_MAX}
            value={title}
            onChange={(event) => edit(() => setTitle(event.target.value))}
          />
          <legend className="fieldset-legend">النص</legend>
          <textarea
            className="textarea w-full"
            rows={2}
            maxLength={NOTIFY_BODY_MAX}
            value={body}
            onChange={(event) => edit(() => setBody(event.target.value))}
          />
        </fieldset>

        <Preview title={title} body={body} fallbackTitle="العنوان" fallbackBody="النص" />

        {notice ? (
          <div
            role="alert"
            className={`alert alert-soft py-2 text-sm ${notice.tone === "error" ? "alert-error" : "alert-success"}`}
          >
            <span>{notice.text}</span>
          </div>
        ) : null}

        {confirming ? (
          <div role="alert" className="alert alert-warning alert-soft flex-wrap text-sm">
            <span className="flex-1">
              سيصل هذا التنبيه فورًا إلى {subscribers.toLocaleString("en-US")} مشترك، ولا يمكن سحبه
              بعد الإرسال.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-warning btn-sm"
                disabled={busy !== null}
                onClick={() => void send()}
              >
                {busy === "send" ? <span className="loading loading-spinner loading-xs" /> : null}
                تأكيد الإرسال
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => setConfirming(false)}
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready || subscribers === 0 || busy !== null}
              onClick={() => {
                setNotice(null);
                setConfirming(true);
              }}
            >
              إرسال إلى كل المشتركين ({subscribers.toLocaleString("en-US")})
            </button>
            {canTest ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!ready || busy !== null}
                onClick={() => void test()}
              >
                {busy === "test" ? <span className="loading loading-spinner loading-xs" /> : null}
                جرّب على هذا الجهاز أولًا
              </button>
            ) : null}
          </div>
        )}

        {subscribers === 0 ? (
          <p className="text-base-content/60 text-sm">لا يوجد مشتركون بعد.</p>
        ) : null}

        {lastBroadcast ? (
          <p className="text-base-content/70 text-sm">
            آخر رسالة: <span className="font-bold">«{lastBroadcast.title}»</span> ·{" "}
            {formatSudan(new Date(lastBroadcast.at), { dateStyle: "medium", timeStyle: "short" })} ·
            وصل إلى {lastBroadcast.delivered} · تعذّر {lastBroadcast.failed} · حُذف{" "}
            {lastBroadcast.removed}
          </p>
        ) : null}
      </div>
    </section>
  );
}

const TEST_FAILURE = {
  "not-subscribed": "الخادم لا يعرف اشتراك هذا المتصفح. أوقف التنبيهات ثم فعّلها من جديد.",
  gone: "انتهى اشتراك هذا المتصفح لدى خدمة التنبيهات وحُذف. فعّل التنبيهات من جديد.",
  refused: "رفضت خدمة التنبيهات الإرسال. حاول مرة أخرى لاحقًا.",
} as const;

/**
 * The operator's own browser as a test subscriber, so the wording and the whole
 * delivery path can be checked without sending anything to players.
 */
function TestOnThisDevice({
  push,
  title,
  body,
}: {
  push: PushSubscriptionControl;
  title: string;
  body: string;
}) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function sendTest() {
    if (!push.endpoint) return;
    setSending(true);
    setResult(null);
    try {
      const outcome = await adminSendTestNotification({
        data: { endpoint: push.endpoint, title: title.trim() || null, body: body.trim() || null },
      });
      setResult(
        outcome.ok
          ? { tone: "success", text: "أُرسل. يفترض أن يظهر التنبيه على هذا الجهاز خلال ثوانٍ." }
          : { tone: "error", text: TEST_FAILURE[outcome.reason] },
      );
    } catch {
      setResult({ tone: "error", text: "تعذّر الإرسال." });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">تجربة على هذا الجهاز</h2>

        {push.state === "on" || (push.state === "working" && push.endpoint) ? (
          <>
            <p className="text-base-content/70 text-sm">
              هذا المتصفح مشترك. التجربة تصل إليه وحده، بالنص المكتوب أعلاه ولو لم يُحفظ بعد.
            </p>
            <div className="card-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={sending || push.state === "working"}
                onClick={() => void sendTest()}
              >
                {sending ? <span className="loading loading-spinner loading-xs" /> : null}
                أرسل تنبيهًا تجريبيًا
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={push.state === "working"}
                onClick={() => void push.unsubscribe()}
              >
                إلغاء اشتراك هذا المتصفح
              </button>
            </div>
          </>
        ) : push.state === "off" || push.state === "working" ? (
          <>
            <p className="text-base-content/70 text-sm">
              فعّل التنبيهات على هذا المتصفح لتجربة الإرسال. سيصله التنبيه اليومي أيضًا كأي مشترك.
            </p>
            <div className="card-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={push.state === "working"}
                onClick={() => void push.subscribe()}
              >
                {push.state === "working" ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : null}
                فعّل التنبيهات على هذا المتصفح
              </button>
            </div>
          </>
        ) : (
          <p className="text-base-content/60 text-sm">
            {push.state === "denied"
              ? "التنبيهات محظورة لهذا الموقع في إعدادات المتصفح."
              : push.state === "needs-install"
                ? "على الآيفون، أضف الموقع إلى الشاشة الرئيسية وافتحه من هناك لتجربة التنبيهات."
                : push.state === "unsupported"
                  ? "هذا المتصفح لا يدعم التنبيهات."
                  : "…"}
          </p>
        )}

        {push.error ? <p className="text-error text-sm">{push.error}</p> : null}
        {result ? (
          <div
            role="alert"
            className={`alert alert-soft py-2 text-sm ${result.tone === "error" ? "alert-error" : "alert-success"}`}
          >
            <span>{result.text}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
