import { Suspense } from "react";
import { AdminIdleGuard } from "@/features/admin/admin-session";
import { requireAdmin } from "@/features/admin/server/guard";
import {
  AdminBottomNav,
  AdminHotkeys,
  AdminPhoneBar,
  AdminSidebar,
} from "@/features/admin/ui/admin-nav";
import { AdminViewMain, AdminViewProvider } from "@/features/admin/ui/admin-view";

/**
 * Everything inside needs the owner or an admin with the second factor and a
 * live admin session. A menu of five groups on the left (a bar along the
 * bottom on a phone); every page brings its own sticky bar with its name
 * and controls.
 */
export default async function AdminSecureLayout({ children }: { children: React.ReactNode }) {
  const context = await requireAdmin();

  return (
    <AdminViewProvider>
      <div className="flex min-h-dvh bg-canvas">
        <Suspense>
          <AdminSidebar role={context.role} />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminPhoneBar />
          <AdminViewMain className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-4 pb-[calc(80px+env(safe-area-inset-bottom))] lg:px-6 lg:pb-10">
            {children}
          </AdminViewMain>
        </div>
        <Suspense>
          <AdminBottomNav role={context.role} />
          <AdminHotkeys role={context.role} />
        </Suspense>
        <AdminIdleGuard expiresAt={context.expiresAt} />
      </div>
    </AdminViewProvider>
  );
}
