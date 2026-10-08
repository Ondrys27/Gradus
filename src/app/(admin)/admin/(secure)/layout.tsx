import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { ADMIN_PATH } from "@/features/admin/access";
import { AdminIdleGuard, AdminSignOutButton } from "@/features/admin/admin-session";
import { requireAdmin } from "@/features/admin/server/guard";

const navLinkClass =
  "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50";

/** Everything inside needs the owner with the second factor and a live admin session. */
export default async function AdminSecureLayout({ children }: { children: React.ReactNode }) {
  const context = await requireAdmin();
  const t = await getTranslations("admin.shell");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex min-h-11 items-center gap-3">
            <Logo className="size-8" />
            <span className="font-bold tracking-tight text-ink">{t("title")}</span>
          </div>
          {/* No prefetch: every view is written to the audit, and only real visits count. */}
          <nav aria-label={t("title")} className="flex flex-1 items-center gap-1">
            <Link href={ADMIN_PATH} prefetch={false} className={navLinkClass}>
              {t("nav.overview")}
            </Link>
            <Link href={`${ADMIN_PATH}/audit`} prefetch={false} className={navLinkClass}>
              {t("nav.audit")}
            </Link>
          </nav>
          <AdminSignOutButton />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <AdminIdleGuard expiresAt={context.expiresAt} />
    </div>
  );
}
