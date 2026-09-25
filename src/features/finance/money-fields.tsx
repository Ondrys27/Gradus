"use client";

import { useTranslations } from "next-intl";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toneSoft } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { DESCRIPTION_MAX, type FinanceErrorKey } from "./schemas";
import { CATEGORIES, TRANSACTION_TYPES, type TransactionType } from "./types";

export type MoneyDraft = {
  type: TransactionType;
  amount: string;
  category: string | null;
  description: string;
};

type Props = {
  idPrefix: string;
  draft: MoneyDraft;
  errors: Partial<Record<string, FinanceErrorKey>>;
  descriptionRequired?: boolean;
  onChange: (patch: Partial<MoneyDraft>) => void;
};

/** The default category of a type; "other" so a quick entry never needs a choice. */
export function defaultCategory(type: TransactionType): string {
  return type === "income" ? "otherIncome" : "otherExpense";
}

/** Type, amount, category and description: what a transaction and a recurring payment share. */
export function MoneyFields({ idPrefix, draft, errors, descriptionRequired, onChange }: Props) {
  const t = useTranslations("finance");
  const err = (key: string) => (errors[key] ? t(`errors.${errors[key]}`) : undefined);
  const categories = CATEGORIES[draft.type].map((value) => ({
    value,
    label: t(`categories.${value}`),
  }));

  return (
    <>
      <div role="radiogroup" aria-label={t("form.type")} className="grid grid-cols-2 gap-2">
        {TRANSACTION_TYPES.map((type) => {
          const selected = draft.type === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() =>
                onChange({
                  type,
                  category: draft.category && CATEGORIES[type].includes(draft.category)
                    ? draft.category
                    : defaultCategory(type),
                })
              }
              className={cn(
                "h-11 cursor-pointer rounded-xl border text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                selected
                  ? toneSoft[type === "income" ? "teal" : "pink"]
                  : "border-line text-ink-soft hover:text-ink",
              )}
            >
              {t(`type.${type}`)}
            </button>
          );
        })}
      </div>

      <FormField id={`${idPrefix}-amount`} label={t("form.amount")} error={err("amount")}>
        <Input
          {...fieldA11y(`${idPrefix}-amount`, err("amount"))}
          value={draft.amount}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => onChange({ amount: event.target.value })}
        />
      </FormField>

      <FormField id={`${idPrefix}-category`} label={t("form.category")}>
        <Select
          value={draft.category ?? defaultCategory(draft.type)}
          items={categories}
          onValueChange={(next) => next && onChange({ category: next })}
        >
          <SelectTrigger id={`${idPrefix}-category`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id={`${idPrefix}-description`}
        label={descriptionRequired ? t("form.description") : t("form.descriptionOptional")}
        error={err("description")}
      >
        <Input
          {...fieldA11y(`${idPrefix}-description`, err("description"))}
          value={draft.description}
          maxLength={DESCRIPTION_MAX + 20}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </FormField>
    </>
  );
}
