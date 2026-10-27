import {
  BriefcaseIcon,
  CircleEllipsisIcon,
  HomeIcon,
  LandmarkIcon,
  LaptopIcon,
  MegaphoneIcon,
  PlaneIcon,
  ShoppingBagIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

export const TRANSACTION_COLUMNS =
  "id, type, amount, currency, category, description, occurred_on, deal_id, invoice_id, recurring_payment_id, source, needs_review";
export const RECURRING_COLUMNS =
  "id, type, amount, currency, category, description, frequency, next_due_on, due_day, last_generated_on, ends_on, is_active";

export type Transaction = Pick<
  Tables["transactions"]["Row"],
  | "id"
  | "type"
  | "amount"
  | "currency"
  | "category"
  | "description"
  | "occurred_on"
  | "deal_id"
  | "invoice_id"
  | "recurring_payment_id"
  | "source"
  | "needs_review"
>;
export type RecurringPayment = Pick<
  Tables["recurring_payments"]["Row"],
  | "id"
  | "type"
  | "amount"
  | "currency"
  | "category"
  | "description"
  | "frequency"
  | "next_due_on"
  | "due_day"
  | "last_generated_on"
  | "ends_on"
  | "is_active"
>;
export type TransactionType = Tables["transactions"]["Row"]["type"];
export type Frequency = Tables["recurring_payments"]["Row"]["frequency"];
export const TRANSACTION_TYPES: readonly TransactionType[] = ["income", "expense"];
export const FREQUENCIES: readonly Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];

/** Category keys are stored as text and named in `finance.categories`. */
export const CATEGORIES: Record<TransactionType, readonly string[]> = {
  income: ["sales", "services", "otherIncome"],
  expense: ["rent", "software", "marketing", "travel", "taxes", "salaries", "otherExpense"],
};
export const ALL_CATEGORIES = [...CATEGORIES.income, ...CATEGORIES.expense];

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  sales: ShoppingBagIcon,
  services: BriefcaseIcon,
  otherIncome: WalletIcon,
  rent: HomeIcon,
  software: LaptopIcon,
  marketing: MegaphoneIcon,
  travel: PlaneIcon,
  taxes: LandmarkIcon,
  salaries: UsersIcon,
  otherExpense: CircleEllipsisIcon,
};

export function categoryIcon(category: string | null): LucideIcon {
  return (category && CATEGORY_ICONS[category]) || CircleEllipsisIcon;
}

export const PERIOD_KINDS = [
  "thisMonth",
  "lastMonth",
  "last3Months",
  "thisYear",
  "last12Months",
] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const FINANCE_TABS = ["transactions", "recurring", "invoices"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
