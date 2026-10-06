import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeDashboard } from "@/features/workers/worker-env/home-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("dashboard") };
}

export default function DashboardPage() {
  return <HomeDashboard />;
}
