"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES, currencyName } from "@/lib/format";
import { useLocale } from "next-intl";
import { ContactPicker } from "./contact-picker";
import type { DealDraft } from "./deal-draft";
import { TITLE_MAX, type PipelineErrorKey } from "./schemas";
import type { Stage } from "./types";

type Props = {
  /** Distinguishes the ids when two forms can be on screen. */
  idPrefix: string;
  draft: DealDraft;
  onChange: (patch: Partial<DealDraft>) => void;
  errors: Partial<Record<string, PipelineErrorKey>>;
  stages: Stage[];
};

/** The fields of a new deal; the detail edits a deal field by field (deal-detail.tsx). */

export function DealFormFields({ idPrefix, draft, onChange, errors, stages }: Props) {
  const t = useTranslations("pipeline");
  const locale = useLocale();

  const currencies = useMemo(
    () =>
      CURRENCIES.map((code) => ({
        value: code,
        label: `${code} · ${currencyName(code, locale)}`,
      })),
    [locale],
  );
  const stageItems = useMemo(
    () => stages.map((stage) => ({ value: stage.id, label: stage.name })),
    [stages],
  );

  const err = (key: string) => {
    const code = errors[key];
    return code ? t(`errors.${code}`) : undefined;
  };

  return (
    <>
      <FormField id={`${idPrefix}-title`} label={t("form.name")} error={err("title")}>
        <Input
          {...fieldA11y(`${idPrefix}-title`, err("title"))}
          value={draft.title}
          maxLength={TITLE_MAX + 20}
          placeholder={t("form.namePlaceholder")}
          autoFocus
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </FormField>
      <FormField id={`${idPrefix}-contact`} label={t("form.contact")}>
        <ContactPicker
          id={`${idPrefix}-contact`}
          value={draft.contact}
          onChange={(contact) => onChange({ contact })}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <FormField id={`${idPrefix}-value`} label={t("form.amount")} error={err("value")}>
          <Input
            {...fieldA11y(`${idPrefix}-value`, err("value"))}
            value={draft.value}
            inputMode="decimal"
            placeholder="0"
            onChange={(event) => onChange({ value: event.target.value })}
          />
        </FormField>
        <FormField id={`${idPrefix}-currency`} label={t("form.currency")} className="sm:w-44">
          <Select
            value={draft.currency}
            items={currencies}
            onValueChange={(next) => next && onChange({ currency: next })}
          >
            <SelectTrigger id={`${idPrefix}-currency`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`${idPrefix}-close`} label={t("form.closeDate")}>
          <DatePicker
            id={`${idPrefix}-close`}
            value={draft.closeDate}
            onValueChange={(closeDate) => onChange({ closeDate })}
            placeholder={t("form.closeDatePlaceholder")}
          />
        </FormField>
        <FormField id={`${idPrefix}-stage`} label={t("form.stage")} error={err("stage_id")}>
          <Select
            value={draft.stageId}
            items={stageItems}
            onValueChange={(next) => next && onChange({ stageId: next })}
          >
            <SelectTrigger id={`${idPrefix}-stage`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageItems.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
    </>
  );
}
