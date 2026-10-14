import { Link, createFileRoute, useRouter, type SearchSchemaInput } from "@tanstack/react-router";
import { useState } from "react";

import { WordPicker } from "#/components/admin/WordPicker.tsx";
import { pageParam } from "#/lib/search-params.ts";
import { formatDateKey, shortDateKey } from "#/lib/sudan-time.ts";
import {
  adminClearDayWord,
  adminTopUpPool,
  adminUpdateSettings,
  getDashboard,
} from "#/server/admin.ts";

export const Route = createFileRoute("/admin/")({
  /** Only the used-words list is paged; the daily job is always one screen. */
  validateSearch: (search: { usedPage?: unknown } & SearchSchemaInput) => ({
    usedPage: pageParam(search.usedPage),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getDashboard({ data: { usedPage: deps.usedPage } }),
  component: DashboardPage,
});

/** A week of buffer is enough notice to refill without watching the number. */
const LOW_POOL_THRESHOLD = 7;

/** Arabic counts day 1, day 2 and days 3–10 differently from the rest. */
function days(count: number): string {
  if (count <= 0) return "لا شيء";
  if (count === 1) return "يوم واحد";
  if (count === 2) return "يومان";
  if (count <= 10) return `${count} أيام`;
  return `${count} يومًا`;
}

function DashboardPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pickingTomorrow, setPickingTomorrow] = useState(false);

  const { pool } = data.stats;
  const tomorrowWord = data.tomorrowScheduled;
  const todayWord = data.todayResolution.status === "ready" ? data.todayResolution.day : null;

  async function run(action: () => Promise<string>) {
    setNotice(null);
    try {
      setNotice(await action());
    } catch {
      setNotice("تعذّر تنفيذ العملية. تحقق من الاتصال بقاعدة البيانات.");
    }
    await router.invalidate();
  }

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- tomorrow --
          The whole job, first and dominant: is tomorrow covered? */}
      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="card-title">كلمة الغد</h1>
              <p className="text-base-content/60 text-sm">{formatDateKey(data.tomorrow)}</p>
            </div>
            <span className={`badge ${tomorrowWord ? "badge-primary" : "badge-ghost"}`}>
              {tomorrowWord ? "اختيار يدوي" : "اختيار تلقائي"}
            </span>
          </div>

          {pickingTomorrow ? (
            <div className="border-base-300 bg-base-200 mt-2 rounded-box border p-4">
              <WordPicker
                dateKey={data.tomorrow}
                heading="تعيين كلمة الغد"
                onDone={() => setPickingTomorrow(false)}
              />
            </div>
          ) : (
            <>
              <div className="bg-base-200 rounded-box my-1 p-6 text-center">
                <p className="min-h-10 text-4xl font-bold tracking-widest">
                  {tomorrowWord ? tomorrowWord.wordText : "—"}
                </p>
                <p className="text-base-content/60 mt-2 text-sm">
                  {tomorrowWord
                    ? "لن يحتاج التطبيق إلى الاختيار التلقائي غدًا."
                    : `إن لم تختر كلمة، سيُختار مرشّح عشوائي عند منتصف الليل. المتاح للاختيار: ${days(pool.available)}.`}
                </p>
              </div>

              <div className="card-actions mt-1">
                <button
                  type="button"
                  className={`btn ${tomorrowWord ? "" : "btn-primary"}`}
                  onClick={() => setPickingTomorrow(true)}
                >
                  {tomorrowWord ? "تغيير كلمة الغد" : "اختر كلمة الغد يدويًا"}
                </button>
                {tomorrowWord ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void run(async () => {
                        const result = await adminClearDayWord({
                          data: { dateKey: data.tomorrow },
                        });
                        return result.ok
                          ? "أُلغي التعيين. سيُختار مرشّح تلقائيًا عند منتصف الليل."
                          : result.reason;
                      })
                    }
                  >
                    إلغاء التعيين
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- the pool --
          Health of the automatic fallback, expressed in days rather than rows. */}
      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body">
          <h2 className="card-title">الاختيار التلقائي</h2>

          {pool.available === 0 ? (
            <div role="alert" className="alert alert-error alert-soft text-sm">
              <span>قائمة المرشحين فارغة. لن يجد التطبيق كلمة لغد إلا إذا عيّنتها يدويًا.</span>
            </div>
          ) : pool.available < LOW_POOL_THRESHOLD ? (
            <div role="alert" className="alert alert-warning alert-soft text-sm">
              <span>المتاح للاختيار التلقائي: {days(pool.available)} فقط.</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-base-content/60 text-sm">كلمات جاهزة للاختيار التلقائي</p>
              <p className="text-3xl font-bold">
                {pool.available}
                <span className="text-base-content/40 text-lg"> / {pool.target}</span>
              </p>
              <p className="text-base-content/50 text-xs">مدة التغطية: {days(pool.available)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={pool.addable === 0}
                onClick={() =>
                  void run(async () => {
                    const result = await adminTopUpPool({ data: {} });
                    return result.added > 0
                      ? `أُضيف ${result.added} من الكلمات السودانية إلى القائمة.`
                      : "لا توجد كلمات سودانية غير مستخدمة يمكن إضافتها.";
                  })
                }
              >
                أكمل القائمة إلى {pool.target}
              </button>
              <Link to="/admin/words" className="btn btn-ghost btn-sm">
                إدارة الكلمات
              </Link>
            </div>
          </div>

          <progress
            className="progress w-full"
            value={pool.available}
            max={Math.max(1, pool.target)}
          />

          <p className="text-base-content/60 text-sm">
            القاموس: {data.stats.dictionaryTotal.toLocaleString("en-US")} كلمة ·{" "}
            {data.stats.dialectTotal} كلمة سودانية ·{" "}
            <span className="text-base-content/50">
              منها {data.stats.dialectAvailable} غير مستخدمة بعد
            </span>
            {data.unknownCount > 0 ? (
              <>
                {" · "}
                <Link
                  to="/admin/words"
                  search={{ q: "", scope: "all", page: 1, queue: 1 }}
                  className="link link-warning"
                >
                  {data.unknownCount} كلمة رفضها القاموس
                </Link>
              </>
            ) : null}
          </p>

          <details className="collapse">
            <summary className="collapse-title p-0 text-sm">الحجم المستهدف للقائمة</summary>
            <TargetSize current={data.settings.poolSize} onSaved={() => void router.invalidate()} />
          </details>
        </div>
      </section>

      {/* ------------------------------------------------------------ today --
          Read-only by default. Changing today affects players mid-game, so the
          escape hatch stays folded away. */}
      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="card-title text-base">كلمة اليوم</h2>
              <p className="text-base-content/60 text-sm">{shortDateKey(data.today)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tracking-widest">
                {todayWord?.wordText ?? "—"}
              </span>
              <span className="badge badge-ghost badge-sm">
                {todayWord?.source === "admin" ? "يدوي" : "تلقائي"}
              </span>
            </div>
          </div>

          {/* Uncontrolled on purpose: the browser owns the disclosure state. */}
          <details className="collapse">
            <summary className="collapse-title p-0 text-sm underline">تغيير كلمة اليوم</summary>
            <div className="collapse-content px-0">
              <p className="text-base-content/60 mb-2 text-xs">
                اللاعبون الحاليون سيرون الكلمة الجديدة فورًا.
              </p>
              <WordPicker dateKey={data.today} heading="تغيير كلمة اليوم" />
            </div>
          </details>
        </div>
      </section>

      {/* ----------------------------------------------------------- recent -- */}
      <UsedWords />
      {notice ? (
        <div role="alert" className="alert alert-info alert-soft">
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every word that has already had its day.
 *
 * Automatic picks can never repeat, so this list exists for the manual path: it
 * is what the operator checks before pinning a word by hand. Paged, because it
 * only ever grows.
 */
function UsedWords() {
  const { usedWords } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const pageCount = Math.max(1, Math.ceil(usedWords.total / usedWords.pageSize));

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title text-base">
            الكلمات التي استُخدمت سابقًا
            <span className="badge badge-ghost badge-sm">{usedWords.total}</span>
          </h2>
          <Link
            to="/admin/words"
            search={{ scope: "served", q: "", page: 1 }}
            className="btn btn-ghost btn-xs"
          >
            ابحث في القائمة كاملة
          </Link>
        </div>

        <p className="text-base-content/60 text-sm">
          الاختيار التلقائي لا يعيد أي كلمة من هذه القائمة. أما الاختيار اليدوي فيسمح بالإعادة بعد
          تنبيه.
        </p>

        <div className="overflow-x-auto">
          <table className="table table-zebra table-sm">
            <thead>
              <tr>
                <th>الكلمة</th>
                <th>أول استخدام</th>
                <th>آخر استخدام</th>
                <th>عدد المرات</th>
                <th>الطريقة</th>
              </tr>
            </thead>
            <tbody>
              {usedWords.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-base-content/60 py-6 text-center">
                    لم تُستخدم أي كلمة بعد.
                  </td>
                </tr>
              ) : (
                usedWords.items.map((word) => (
                  <tr key={`${word.wordText}-${word.lastDateKey}`}>
                    <td className="text-lg font-bold tracking-widest">{word.wordText}</td>
                    <td className="font-mono text-xs" dir="ltr">
                      {word.firstDateKey}
                    </td>
                    <td className="font-mono text-xs" dir="ltr">
                      {word.lastDateKey}
                    </td>
                    <td>{word.times > 1 ? word.times : "—"}</td>
                    <td>
                      <span
                        className={`badge badge-sm ${
                          word.source === "admin" ? "badge-primary" : "badge-ghost"
                        }`}
                      >
                        {word.source === "admin"
                          ? "يدوي"
                          : word.source === "auto"
                            ? "تلقائي"
                            : "الاثنان"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="join mx-auto">
            <button
              type="button"
              className="btn join-item btn-sm"
              disabled={usedWords.page <= 1}
              onClick={() => void navigate({ search: { ...search, usedPage: usedWords.page - 1 } })}
            >
              السابق
            </button>
            <span className="btn join-item btn-sm pointer-events-none">
              {usedWords.page} / {pageCount}
            </span>
            <button
              type="button"
              className="btn join-item btn-sm"
              disabled={usedWords.page >= pageCount}
              onClick={() => void navigate({ search: { ...search, usedPage: usedWords.page + 1 } })}
            >
              التالي
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The target size of the candidate pool, tucked inside the concept it belongs to. */
function TargetSize({ current, onSaved }: { current: number; onSaved: () => void }) {
  const [size, setSize] = useState(current);
  const [busy, setBusy] = useState(false);

  return (
    <div className="collapse-content px-0">
      <div className="join">
        <input
          type="number"
          min={1}
          max={500}
          className="input join-item w-28"
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
        />
        <button
          type="button"
          className="btn join-item"
          disabled={busy || size === current}
          onClick={() => {
            setBusy(true);
            void adminUpdateSettings({ data: { poolSize: size } })
              .then(onSaved)
              .finally(() => setBusy(false));
          }}
        >
          حفظ
        </button>
      </div>
      <p className="text-base-content/60 mt-1 text-xs">
        عدد الكلمات التي تريد الاحتفاظ بها جاهزة للاختيار التلقائي.
      </p>
    </div>
  );
}
