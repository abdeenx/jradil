import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { SiteHeader } from "#/components/SiteHeader.tsx";
import { APP_NAME_AR } from "#/lib/config.ts";
import { adminLogin, getAdminSession } from "#/server/admin.ts";

/**
 * Operator sign-in.
 *
 * This route deliberately sits outside the `admin` layout (the trailing
 * underscore in the file name), so it can render while the layout is bouncing
 * an unauthenticated visitor here.
 */
export const Route = createFileRoute("/admin_/login")({
  beforeLoad: async () => {
    const session = await getAdminSession();
    if (session.configured && session.authenticated) {
      throw redirect({ to: "/admin" });
    }
    return { session };
  },
  component: LoginPage,
});

function LoginPage() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const result = await adminLogin({ data: { password } });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPassword("");
      await router.invalidate();
      await router.navigate({ to: "/admin" });
    } catch {
      setMessage("تعذّر الاتصال بالخادم. تحقق من إعداد قاعدة البيانات.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-3 pt-12">
        <div className="card bg-base-100 border-base-300 border">
          <div className="card-body">
            <h1 className="card-title">لوحة مشرف {APP_NAME_AR}</h1>

            {session.configured ? (
              <p className="text-base-content/70 text-sm">
                سجّل الدخول لاختيار كلمة اليوم وإدارة القاموس.
              </p>
            ) : (
              <div role="alert" className="alert alert-warning alert-soft text-sm">
                <span>
                  لم يُضبط <code dir="ltr">ADMIN_PASSWORD</code> على الخادم. أضفه إلى ملف{" "}
                  <code dir="ltr">.env</code> ثم أعد تشغيل التطبيق.
                </span>
              </div>
            )}

            {session.configured ? (
              <form onSubmit={(event) => void submit(event)} className="mt-2">
                <fieldset className="fieldset">
                  <legend className="fieldset-legend">كلمة المرور</legend>
                  <input
                    type="password"
                    dir="ltr"
                    className="input w-full"
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </fieldset>

                {message ? (
                  <div role="alert" className="alert alert-error alert-soft mt-2 py-2 text-sm">
                    <span>{message}</span>
                  </div>
                ) : null}

                <div className="card-actions mt-4">
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={busy || password.length === 0}
                  >
                    {busy ? <span className="loading loading-spinner loading-sm" /> : null}
                    دخول
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
