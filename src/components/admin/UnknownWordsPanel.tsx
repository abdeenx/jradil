import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { shortDateKey } from "#/lib/sudan-time.ts";
import type { UnknownWordsPage } from "#/lib/unknown-words.ts";
import { adminAddUnknownWords, adminForgetUnknownWords } from "#/server/admin.ts";

/**
 * The review queue of words players tried that the dictionary does not have.
 *
 * Players are the best source of what the dictionary is missing, but they also
 * mistype — so this is a queue to empty, not a list to keep: every word is
 * either added to the dictionary or dropped.
 *
 * Adding defaults to a plain dictionary word. Becoming eligible to be the word
 * of the day is a separate decision the operator makes deliberately, because a
 * word a player reached for is not thereby a good word to serve.
 */
export function UnknownWordsPanel({
  queue,
  page,
  onPageChange,
}: {
  queue: UnknownWordsPage;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const router = useRouter();
  const [dialect, setDialect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(queue.total / queue.pageSize));

  async function run(action: () => Promise<string>) {
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

  const addLabels = dialect ? "أضف الكل ككلمات سودانية" : "أضف الكل إلى القاموس";

  return (
    <section className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">
            كلمات رفضها القاموس
            <span className={`badge badge-sm ${queue.total > 0 ? "badge-warning" : "badge-ghost"}`}>
              {queue.total}
            </span>
          </h2>
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={dialect}
              onChange={(event) => setDialect(event.target.checked)}
            />
            <span className="label-text text-sm">علّمها كلمات سودانية (تصبح مؤهلة لكلمة اليوم)</span>
          </label>
        </div>

        <p className="text-base-content/70 text-sm">
          كلمات حاول اللاعبون استخدامها ولم توجد في القاموس. أضف ما تراه صحيحًا، وتجاهل ما كان خطأ
          إملائيًا — فالقائمة لا تنقص إلا بما تُفرّغ به.
        </p>

        {queue.total === 0 ? (
          <p className="text-base-content/60 py-4 text-center text-sm">
            لا توجد كلمات بانتظار المراجعة.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>الكلمة</th>
                    <th>المحاولات</th>
                    <th>آخر محاولة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-lg font-bold tracking-widest">{entry.text}</td>
                      <td>
                        <span className="badge badge-ghost badge-sm">{entry.count}</span>
                      </td>
                      <td className="text-base-content/60 text-xs">
                        {shortDateKey(entry.lastAt.slice(0, 10))}
                      </td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="btn btn-xs"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await adminAddUnknownWords({
                                data: { ids: [entry.id], dialect },
                              });
                              return result.alreadyKnown > 0
                                ? `«${entry.text}» موجودة في القاموس أصلًا، وأُزيلت من القائمة.`
                                : `أُضيفت «${entry.text}» إلى القاموس.`;
                            })
                          }
                        >
                          أضف
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-error"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await adminForgetUnknownWords({
                                data: { ids: [entry.id] },
                              });
                              return `تُجوهلت ${result.removed} كلمة.`;
                            })
                          }
                        >
                          تجاهل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <div className="join mx-auto">
                <button
                  type="button"
                  className="btn join-item btn-sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
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
                  onClick={() => onPageChange(page + 1)}
                >
                  التالي
                </button>
              </div>
            ) : null}

            <div className="card-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    // An empty selection means the whole queue, not the page — the
                    // button says "all" and the operator means all of it.
                    const result = await adminAddUnknownWords({ data: { ids: [], dialect } });
                    return `${result.added} كلمة أُضيفت، و${result.alreadyKnown} كانت موجودة أصلًا.`;
                  })
                }
              >
                {busy ? <span className="loading loading-spinner loading-sm" /> : null}
                {addLabels}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await adminForgetUnknownWords({ data: { ids: [] } });
                    return `أُفرغت القائمة (${result.removed} كلمة).`;
                  })
                }
              >
                تجاهل الكل
              </button>
            </div>
          </>
        )}

        {notice ? (
          <div role="alert" className="alert alert-info alert-soft py-2 text-sm">
            <span>{notice}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
