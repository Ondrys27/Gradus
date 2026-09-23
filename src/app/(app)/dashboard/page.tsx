import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: `${t("dashboard")} · ${APP_NAME}` };
}

export default function DashboardPage() {
  return <SectionPlaceholder section="dashboard" />;
}
