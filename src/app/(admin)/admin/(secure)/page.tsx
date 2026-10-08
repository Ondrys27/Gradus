import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

export default async function AdminOverviewPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "overview");
  const t = await getTranslations("admin.overview");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <GlowCard interactive={false} className="flex flex-col gap-2">
        <p className="text-sm text-ink-soft">{t("auditHint")}</p>
        <Link
          href={`${ADMIN_PATH}/audit`}
          prefetch={false}
          className="flex min-h-11 w-fit items-center font-medium text-violet underline-offset-4 hover:underline"
        >
          {t("auditLink")}
        </Link>
      </GlowCard>
    </>
  );
}
