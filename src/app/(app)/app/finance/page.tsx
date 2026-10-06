import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FinanceView } from "@/features/finance/finance-view";
import { FINANCE_TABS, type FinanceTab } from "@/features/finance/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("finance") };
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = FINANCE_TABS.find((value): value is FinanceTab => value === tab);
  return <FinanceView initialTab={initialTab} />;
}
