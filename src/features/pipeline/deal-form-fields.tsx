"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
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
import { DESCRIPTION_MAX, REASON_MAX, TITLE_MAX, type PipelineErrorKey } from "./schemas";
import type { Stage } from "./types";

type Props = {
  /** Distinguishes the ids when two forms can be on screen. */
  idPrefix: string;
  draft: DealDraft;
  onChange: (patch: Partial<DealDraft>) => void;
  errors: Partial<Record<string, PipelineErrorKey>>;
  /** Present in the create form; the detail changes the stage through its own control. */
  stages?: Stage[];
  showLostReason?: boolean;
};

export function DealFormFields({
  idPrefix,
  draft,
  onChange,
  errors,
  stages,
  showLostReason,
}: Props) {
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
    () => (stages ?? []).map((stage) => ({ value: stage.id, label: stage.name })),
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
          autoFocus={!!stages}
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
      <div className={stages ? "grid gap-4 sm:grid-cols-2" : undefined}>
        <FormField id={`${idPrefix}-close`} label={t("form.closeDate")}>
          <DatePicker
            id={`${idPrefix}-close`}
            value={draft.closeDate}
            onValueChange={(closeDate) => onChange({ closeDate })}
            placeholder={t("form.closeDatePlaceholder")}
          />
        </FormField>
        {stages && (
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
        )}
      </div>
      {!stages && (
        <FormField
          id={`${idPrefix}-description`}
          label={t("detail.notes")}
          error={err("description")}
        >
          <Textarea
            {...fieldA11y(`${idPrefix}-description`, err("description"))}
            value={draft.description}
            maxLength={DESCRIPTION_MAX + 100}
            placeholder={t("detail.notesPlaceholder")}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </FormField>
      )}
      {showLostReason && (
        <FormField
          id={`${idPrefix}-reason`}
          label={t("detail.lostReason")}
          error={err("lost_reason")}
        >
          <Textarea
            {...fieldA11y(`${idPrefix}-reason`, err("lost_reason"))}
            value={draft.lostReason}
            maxLength={REASON_MAX + 50}
            onChange={(event) => onChange({ lostReason: event.target.value })}
          />
        </FormField>
      )}
    </>
  );
}
