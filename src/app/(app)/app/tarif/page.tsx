import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { PlanPage } from "@/features/plan/plan-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans.page");
  return { title: t("title") };
}

/** The plans of the published catalog, the same the website shows. */
export default async function TarifPage() {
  return <PlanPage plans={await getPublishedPlans()} />;
}
