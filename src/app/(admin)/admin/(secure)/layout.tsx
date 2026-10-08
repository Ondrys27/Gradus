import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { metricsToday } from "@/lib/analytics/metrics";
import { countryName } from "@/lib/format";
import { AdminIdleGuard, AdminSignOutButton } from "@/features/admin/admin-session";
import { requireAdmin } from "@/features/admin/server/guard";
import { openSegmentValues, safe } from "@/features/admin/server/metrics-data";
import { AdminControls, type OpenSegmentOptions } from "@/features/admin/ui/admin-controls";
import { AdminNav } from "@/features/admin/ui/admin-nav";

/**
 * Everything inside needs the owner with the second factor and a live admin
 * session. A sidebar of sections and, above every page, the shared controls.
 */
export default async function AdminSecureLayout({ children }: { children: React.ReactNode }) {
  const context = await requireAdmin();
  const [t, tIndustry, locale, values] = await Promise.all([
    getTranslations("admin.shell"),
    getTranslations("onboarding.industry.industries"),
    getLocale(),
    safe("segment values", openSegmentValues),
  ]);

  const openOptions: OpenSegmentOptions = values.ok
    ? {
        industry: values.data.industry.map((value) => ({
          value,
          label: tIndustry.has(`${value}.label`) ? tIndustry(`${value}.label`) : value,
        })),
        country: values.data.country.map((value) => ({
          value,
          label: countryName(value, locale),
        })),
      }
    : {};

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-canvas-deep/60 px-3 py-4 lg:flex">
        <div className="flex min-h-11 items-center gap-3 px-2">
          <Logo className="size-8" />
          <span className="font-bold tracking-tight text-ink">{t("title")}</span>
        </div>
        <Suspense>
          <AdminNav variant="sidebar" />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky only where there is room; on a phone the controls would cover the numbers. */}
        <header className="z-30 border-b border-line bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur lg:sticky lg:top-0">
          <div className="flex w-full flex-col gap-2 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="flex min-h-11 items-center gap-3 lg:hidden">
                <Logo className="size-8" />
                <span className="font-bold tracking-tight text-ink">{t("title")}</span>
              </div>
              <div className="ml-auto">
                <AdminSignOutButton />
              </div>
            </div>
            <div className="lg:hidden">
              <Suspense>
                <AdminNav variant="strip" />
              </Suspense>
            </div>
            <Suspense>
              <AdminControls today={metricsToday()} openOptions={openOptions} />
            </Suspense>
          </div>
        </header>
        <main className="flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
          {children}
        </main>
      </div>
      <AdminIdleGuard expiresAt={context.expiresAt} />
    </div>
  );
}
