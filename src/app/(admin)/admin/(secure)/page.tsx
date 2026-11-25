import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { isEmailConfirmationRequired } from "@/features/auth/email-confirmation";
import { AdminDashboard } from "@/features/admin/dashboard/admin-dashboard";
import { loadAdminDashboard } from "@/features/admin/dashboard/server/layouts";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe } from "@/features/admin/server/metrics-data";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { CardSkeleton } from "@/features/admin/ui/blocks";
import type { AdminContext } from "@/features/admin/server/guard";
import { isPublicSignupEnabled } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The overview (29.2): the administrator's own board of widgets with tabs.
 * The view is audited once per opening of the page; the widgets then read
 * their numbers through /api/admin/widgets/<key> (guarded, not audited per
 * widget), for the period and filters of the top bar.
 */
export default async function AdminOverviewPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "overview");
  const q = adminQuery(await searchParams, "overview");

  return (
    <>
      <AdminPageHeader section="overview" q={q} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={null}>
          <SignupWarning />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={420} />}>
          <Board context={context} />
        </Suspense>
      </div>
    </>
  );
}

async function Board({ context }: { context: AdminContext }) {
  const loaded = await safe("overview layouts", () => loadAdminDashboard(context));
  return (
    <Show loaded={loaded}>
      {(initial) => (
        <AdminDashboard actor={{ role: context.role, level: context.level }} initial={initial} />
      )}
    </Show>
  );
}

/**
 * Public sign-up without e-mail confirmation lets anyone register with
 * someone else's address: the switch is in Supabase, the app only reads it.
 */
async function SignupWarning() {
  if (!isPublicSignupEnabled() || (await isEmailConfirmationRequired())) return null;
  const t = await getTranslations("admin.overview");
  return (
    <div
      role="note"
      data-testid="admin-signup-warning"
      className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-pretty text-ink"
    >
      {t("signupWithoutConfirmation")}
    </div>
  );
}
