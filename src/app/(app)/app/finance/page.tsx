import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FinanceView } from "@/features/finance/finance-view";
import { FINANCE_TABS, type FinanceTab } from "@/features/finance/types";
import { categoryNames } from "@/features/finance/plan/category-names";
import { isPlanMonth } from "@/features/finance/plan/weeks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("finance") };
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const { tab, month } = await searchParams;
  const initialTab = FINANCE_TABS.find((value): value is FinanceTab => value === tab);
  return (
    <FinanceView
      initialTab={initialTab}
      initialMonth={isPlanMonth(month) ? month : undefined}
      categoryNames={categoryNames()}
    />
  );
}
