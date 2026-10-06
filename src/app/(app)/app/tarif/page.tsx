import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanPage } from "@/features/plan/plan-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans.page");
  return { title: t("title") };
}

export default function TarifPage() {
  return <PlanPage />;
}
