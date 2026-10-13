import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { SiteHeader } from "#/components/SiteHeader.tsx";
import { adminLogout, getAdminSession } from "#/server/admin.ts";

/**
 * The operator area.
 *
 * Anything under `/admin` requires a session, so the check happens in
 * `beforeLoad` and every child loader can assume it is already authorised.
 * Unauthenticated visitors are sent to the login screen, which lives outside
 * this layout.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const session = await getAdminSession();
    if (!session.configured || !session.authenticated) {
      throw redirect({ to: "/admin/login" });
    }
    return { session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const router = useRouter();

  async function logout() {
    await adminLogout();
    await router.invalidate();
    await router.navigate({ to: "/admin/login" });
  }

  return (
    <>
      <SiteHeader subtitle="لوحة المشرف" />

      <main className="mx-auto w-full max-w-5xl px-3 pt-6 pb-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="tabs tabs-box w-fit">
            <Link
              to="/admin"
              activeOptions={{ exact: true }}
              className="tab"
              activeProps={{ className: "tab tab-active" }}
            >
              كلمة اليوم
            </Link>
            <Link to="/admin/words" className="tab" activeProps={{ className: "tab tab-active" }}>
              الكلمات
            </Link>
          </div>

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            خروج
          </button>
        </div>

        <Outlet />
      </main>
    </>
  );
}
