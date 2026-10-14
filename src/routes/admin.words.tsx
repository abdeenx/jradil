import { createFileRoute, useRouter, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { UnknownWordsPanel } from "#/components/admin/UnknownWordsPanel.tsx";
import { WordEditDialog } from "#/components/admin/WordEditDialog.tsx";
import { WORD_LETTER_COUNT } from "#/lib/config.ts";
import { enumParam, pageParam, textParam } from "#/lib/search-params.ts";
import { isSafeExternalLink } from "#/lib/url.ts";
import type { ImportSummary } from "#/lib/word-import.ts";
import type { WordView } from "#/lib/words.ts";
import {
  adminBulkUpdateWords,
  adminDeleteWord,
  adminGetSettings,
  adminImportWords,
  adminListUnknownWords,
  adminListWords,
  adminUpdateSettings,
  adminUpdateWord,
} from "#/server/admin.ts";

const SCOPES = ["all", "dialect", "pool", "served", "unserved"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_LABELS: Record<Scope, string> = {
  all: "كل الكلمات",
  dialect: "سودانية",
  pool: "في قائمة الاختيار",
  served: "استُخدمت",
  unserved: "لم تُستخدم",
};

export const Route = createFileRoute("/admin/words")({
  validateSearch: (
    search: { q?: unknown; scope?: unknown; page?: unknown; queue?: unknown } & SearchSchemaInput,
  ) => ({
    // The server refuses a longer search term.
    q: textParam(search.q, 200),
    scope: enumParam(search.scope, SCOPES, "all"),
    page: pageParam(search.page),
    // The review queue pages separately: emptying it is a different job from
    // browsing the dictionary.
    queue: pageParam(search.queue),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const filter =
      deps.scope === "dialect"
        ? { dialect: true }
        : deps.scope === "pool"
          ? { pool: true }
          : deps.scope === "served"
            ? { served: true }
            : deps.scope === "unserved"
              ? { served: false }
              : {};

    const [words, settings, unknown] = await Promise.all([
      adminListWords({
        data: { ...filter, search: deps.q || undefined, page: deps.page, pageSize: 50 },
      }),
      adminGetSettings(),
      adminListUnknownWords({ data: { page: deps.queue, pageSize: 30 } }),
    ]);
    return { words, settings, unknown };
  },
  component: WordsPage,
});

function WordsPage() {
  const { words, settings, unknown } = Route.useLoaderData();
  const { items, total, page, pageSize } = words;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const [query, setQuery] = useState(search.q);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<WordView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new page or filter invalidates whatever was ticked on the old one.
  useEffect(() => setSelected([]), [page, search.scope, search.q]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = items.length > 0 && selected.length === items.length;

  async function mutate(action: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
      await router.invalidate();
    } catch {
      setNotice("تعذّر تنفيذ العملية. تحقق من الاتصال بقاعدة البيانات.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...previous, id] : previous.filter((value) => value !== id),
    );
  }

  return (
    <div className="space-y-5">
      <UnknownWordsPanel
        queue={unknown}
        page={search.queue}
        onPageChange={(next) => void navigate({ search: { ...search, queue: next } })}
      />

      <ImportPanel onDone={() => void router.invalidate()} />

      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="card-title">الكلمات</h1>
            <span className="badge badge-ghost">{total.toLocaleString("en-US")} كلمة</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <form
              className="join grow"
              onSubmit={(event) => {
                event.preventDefault();
                void navigate({ search: { ...search, q: query, page: 1 } });
              }}
            >
              <input
                className="input join-item grow"
                placeholder="ابحث عن كلمة…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="btn join-item" type="submit">
                بحث
              </button>
            </form>

            <select
              className="select w-fit"
              value={search.scope}
              onChange={(event) =>
                void navigate({
                  search: { ...search, scope: event.target.value as Scope, page: 1 },
                })
              }
            >
              {SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </div>

          <div className="border-base-300 bg-base-200 flex flex-wrap items-center gap-2 rounded-box border p-2">
            <span className="text-base-content/60 text-sm">
              {selected.length > 0 ? `${selected.length} محددة` : "حدّد كلمات لتعليمها دفعة واحدة"}
            </span>
            <div className="join">
              <button
                type="button"
                className="btn join-item btn-sm"
                disabled={busy || selected.length === 0}
                title="تصبح مؤهلة لكن لا تدخل قائمة الاختيار التلقائي"
                onClick={() =>
                  void mutate(async () => {
                    const result = await adminBulkUpdateWords({
                      data: { ids: selected, dialect: true },
                    });
                    return `عُلّمت ${result.modified} كلمة كسودانية.`;
                  })
                }
              >
                اجعلها سودانية
              </button>
              <button
                type="button"
                className="btn join-item btn-sm"
                disabled={busy || selected.length === 0}
                title="تصبح سودانية ومعرّضة للاختيار التلقائي"
                onClick={() =>
                  void mutate(async () => {
                    const result = await adminBulkUpdateWords({
                      data: { ids: selected, pool: true },
                    });
                    return `أُضيفت ${result.modified} كلمة إلى قائمة الاختيار.`;
                  })
                }
              >
                أضف إلى قائمة الاختيار
              </button>
              <button
                type="button"
                className="btn join-item btn-sm btn-ghost text-error"
                disabled={busy || selected.length === 0}
                title="تُزال صفة السودانية ومعها القائمة"
                onClick={() =>
                  void mutate(async () => {
                    const result = await adminBulkUpdateWords({
                      data: { ids: selected, dialect: false },
                    });
                    return `أُزيلت صفة السودانية عن ${result.modified} كلمة.`;
                  })
                }
              >
                ليست سودانية
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={allSelected}
                      aria-label="تحديد الكل"
                      onChange={(event) =>
                        setSelected(event.target.checked ? items.map((item) => item.id) : [])
                      }
                    />
                  </th>
                  <th>الكلمة</th>
                  <th title="مؤهلة لتكون كلمة اليوم">سودانية</th>
                  <th title="تدخل الاختيار التلقائي">في القائمة</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-base-content/60 py-6 text-center">
                      لا توجد نتائج. استخدم لوحة الاستيراد بالأعلى لإضافة كلمات.
                    </td>
                  </tr>
                ) : (
                  items.map((word) => (
                    <tr key={word.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selected.includes(word.id)}
                          aria-label={`تحديد ${word.text}`}
                          onChange={(event) => toggle(word.id, event.target.checked)}
                        />
                      </td>
                      <td className="text-lg font-bold tracking-widest">
                        {word.text}
                        {isSafeExternalLink(word.link) ? (
                          <a
                            href={word.link}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="link ms-2 align-middle text-xs font-normal"
                            title="الرابط الذي يراه اللاعب"
                          >
                            ↗
                          </a>
                        ) : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={word.dialect}
                          disabled={busy}
                          aria-label={`${word.text} كلمة سودانية`}
                          onChange={(event) =>
                            void mutate(async () => {
                              const result = await adminUpdateWord({
                                data: { id: word.id, dialect: event.target.checked },
                              });
                              return result.ok ? `حُدّثت «${word.text}».` : result.reason;
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={word.pool}
                          disabled={busy}
                          aria-label={`${word.text} في قائمة الاختيار`}
                          onChange={(event) =>
                            void mutate(async () => {
                              const result = await adminUpdateWord({
                                data: { id: word.id, pool: event.target.checked },
                              });
                              return result.ok ? `حُدّثت «${word.text}».` : result.reason;
                            })
                          }
                        />
                      </td>
                      <td>
                        {word.firstServedDateKey ? (
                          <span className="badge badge-ghost badge-sm" dir="ltr">
                            {word.firstServedDateKey}
                          </span>
                        ) : word.assignedDateKey ? (
                          <span className="badge badge-info badge-sm">محجوزة</span>
                        ) : (
                          <span className="text-base-content/40 text-xs">جاهزة</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => setEditing(word)}
                        >
                          بيانات
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() =>
                            void mutate(async () => {
                              const result = await adminDeleteWord({ data: { id: word.id } });
                              return result.ok ? `حُذفت «${word.text}».` : result.reason;
                            })
                          }
                        >
                          حذف
                        </button>
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
                disabled={page <= 1}
                onClick={() => void navigate({ search: { ...search, page: page - 1 } })}
              >
                السابق
              </button>
              <span className="btn join-item btn-sm pointer-events-none">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                className="btn join-item btn-sm"
                disabled={page >= pageCount}
                onClick={() => void navigate({ search: { ...search, page: page + 1 } })}
              >
                التالي
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <DictionarySettings enforceDictionary={settings.enforceDictionary} total={total} />

      {notice ? (
        <div role="alert" className="alert alert-info alert-soft">
          <span>{notice}</span>
        </div>
      ) : null}

      <WordEditDialog
        word={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void router.invalidate()}
      />
    </div>
  );
}

/**
 * Bulk loading.
 *
 * One box for everything: a single word, a pasted list, CSV, or JSON. The
 * switches are the two phases the dictionary is actually built in — first the
 * general Arabic words, then the Sudanese ones.
 */
function ImportPanel({ onDone }: { onDone: () => void }) {
  const [payload, setPayload] = useState("");
  const [sudanese, setSudanese] = useState(true);
  const [addToPool, setAddToPool] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await adminImportWords({
        data: {
          payload,
          dialect: sudanese,
          pool: sudanese ? addToPool : false,
        },
      });
      setSummary(result);
      onDone();
    } catch {
      setError("تعذّر الاستيراد. تأكّد من الصيغة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body">
        <h2 className="card-title">إضافة كلمات</h2>
        <p className="text-base-content/70 text-sm">
          كلمة في كل سطر، أو CSV، أو JSON. الصفوف التي ليست من {WORD_LETTER_COUNT} حروف عربية تُتخطّى
          وتُدرَج في التقرير. إعادة الاستيراد آمنة.
        </p>

        <div className="flex flex-wrap gap-4">
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={sudanese}
              onChange={(event) => setSudanese(event.target.checked)}
            />
            <span className="label-text">كلمات سودانية (مؤهلة لتكون كلمة اليوم)</span>
          </label>

          <label
            className={`label justify-start gap-2 ${sudanese ? "cursor-pointer" : "opacity-40"}`}
          >
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={sudanese && addToPool}
              disabled={!sudanese}
              onChange={(event) => setAddToPool(event.target.checked)}
            />
            <span className="label-text">أضفها إلى قائمة الاختيار التلقائي</span>
          </label>
        </div>

        <textarea
          className="textarea h-40 w-full font-mono text-sm"
          dir="ltr"
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          placeholder={"طنجره\nبابور\nعربيه"}
        />

        <div className="card-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || payload.trim().length === 0}
            onClick={() => void submit()}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : null}
            استيراد
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setPayload("");
              setSummary(null);
              setError(null);
            }}
          >
            تفريغ
          </button>
        </div>

        {error ? (
          <div role="alert" className="alert alert-error alert-soft py-2 text-sm">
            <span>{error}</span>
          </div>
        ) : null}

        {summary ? (
          summary.received === 0 ? (
            <div role="alert" className="alert alert-warning alert-soft text-sm">
              <span>لم يُعثر على كلمات في النص. تحقّق من الصيغة.</span>
            </div>
          ) : (
            <div role="alert" className="alert alert-success alert-soft">
              <div className="text-sm">
                <p>
                  أُضيفت {summary.inserted} كلمة، ووُجدت مسبقًا {summary.matched}، وتُخطّي{" "}
                  {summary.skipped.length}.
                </p>
                {summary.skipped.length > 0 ? (
                  <details className="collapse mt-1">
                    <summary className="collapse-title p-0 text-xs">عرض المتخطّى</summary>
                    <ul className="collapse-content p-0 text-xs">
                      {summary.skipped.slice(0, 50).map((item, index) => (
                        <li key={`${item.text}-${index}`}>
                          {item.text} — {item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

/** Whether unknown words are refused. A dictionary concern, so it lives here. */
function DictionarySettings({
  enforceDictionary,
  total,
}: {
  enforceDictionary: boolean;
  total: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [enforce, setEnforce] = useState(enforceDictionary);

  useEffect(() => setEnforce(enforceDictionary), [enforceDictionary]);

  async function toggle(next: boolean) {
    setEnforce(next);
    setBusy(true);
    try {
      await adminUpdateSettings({ data: { enforceDictionary: next } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body">
        <h2 className="card-title text-base">التحقق من القاموس</h2>
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox"
            checked={enforce}
            disabled={busy}
            onChange={(event) => void toggle(event.target.checked)}
          />
          <span className="label-text">ارفض التخمينات غير الموجودة في القاموس</span>
        </label>
        <p className="text-base-content/60 text-xs">
          عند الإيقاف تُقبل أي كلمة من خمسة حروف عربية — مفيد أثناء رفع الكلمات على مراحل قبل أن يكتمل
          القاموس. القاموس الحالي: {total.toLocaleString("en-US")} كلمة.
        </p>
      </div>
    </section>
  );
}
