"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon, ShuffleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { SimpleSelect } from "@/features/invoices/simple-select";
import {
  BENEFIT_LIMITS,
  generatePromoCode,
  normalizePromoCode,
  PARTNER_NAME_MAX,
  PARTNER_NOTE_MAX,
  PROMO_BENEFITS,
  PROMO_CODE_MAX,
  PROMO_KINDS,
  promoCodeFormSchema,
  promoFormErrors,
  type PromoBenefitKind,
  type PromoCodeFormInput,
  type PromoFormError,
  type PromoKind,
} from "@/features/promo/codes";
import { usePromoOfferText } from "@/features/promo/promo-code-field";
import { savePromoCode, type PromoSaveResult } from "../server/promo-actions";

/** What the form edits; numbers as typed, so a field can be empty while typing. */
export type PromoCodeDraft = {
  code: string;
  partnerName: string;
  partnerEmail: string;
  partnerNote: string;
  kind: PromoKind;
  benefit: PromoBenefitKind;
  benefitValue: string;
  commissionPercent: string;
  maxUses: string;
  validFrom: string;
  validTo: string;
  active: boolean;
};

const NEW_CODE: PromoCodeDraft = {
  code: "",
  partnerName: "",
  partnerEmail: "",
  partnerNote: "",
  kind: "influencer",
  benefit: "percent_off_first",
  benefitValue: "50",
  commissionPercent: "20",
  maxUses: "",
  validFrom: "",
  validTo: "",
  active: true,
};

const number = (value: string) => (value.trim() === "" ? NaN : Number(value.replace(",", ".")));

function toInput(draft: PromoCodeDraft): PromoCodeFormInput {
  return {
    ...draft,
    benefitValue: number(draft.benefitValue),
    commissionPercent: number(draft.commissionPercent),
    maxUses: draft.maxUses.trim() === "" ? null : number(draft.maxUses),
  };
}

const textareaClass =
  "min-h-20 w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30";

/**
 * A new promo code, or an edit of one, in a dialog. The code is typed or
 * generated; its text stays once an account used it (the links that went
 * out must keep working). The line under the benefit is what users see.
 */
export function PromoCodeDialog({
  id,
  saved,
  used = false,
  trigger = "button",
}: {
  /** The code edited; none for a new one. */
  id?: string;
  saved?: PromoCodeDraft;
  /** An account already used it: the text of the code is locked. */
  used?: boolean;
  trigger?: "button" | "icon";
}) {
  const t = useTranslations("admin.promoCodes.form");
  const tAll = useTranslations("admin.promoCodes");
  const offerText = usePromoOfferText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PromoCodeDraft>(saved ?? NEW_CODE);
  const [errors, setErrors] = useState<PromoFormError[]>([]);
  const [problem, setProblem] = useState<Exclude<PromoSaveResult, { ok: true }>["error"] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<PromoCodeDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors([]);
    setProblem(null);
  };
  const err = (field: PromoFormError) =>
    errors.includes(field) ? t(`errors.${field}`) : undefined;
  const limits = BENEFIT_LIMITS[draft.benefit];
  const benefitValue = number(draft.benefitValue);
  const preview =
    Number.isInteger(benefitValue) && benefitValue >= limits.min && benefitValue <= limits.max
      ? offerText({
          code: normalizePromoCode(draft.code) || "XYZ",
          benefit: draft.benefit,
          value: benefitValue,
        })
      : null;

  function openDialog() {
    setDraft(saved ?? NEW_CODE);
    setErrors([]);
    setProblem(null);
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = toInput(draft);
    const parsed = promoCodeFormSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(promoFormErrors(parsed.error));
      return;
    }
    startTransition(async () => {
      const result = await savePromoCode(id ?? null, input).catch((): PromoSaveResult => ({
        ok: false,
        error: "failed",
      }));
      if (!result.ok) {
        if (result.error === "invalid") setErrors(result.fields);
        setProblem(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {trigger === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openDialog}
          data-testid="promo-edit"
        >
          <PencilIcon aria-hidden />
          {tAll("actions.edit")}
        </Button>
      ) : (
        <Button type="button" onClick={openDialog} data-testid="promo-create">
          <PlusIcon aria-hidden />
          {tAll("actions.create")}
        </Button>
      )}
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={id ? t("titleEdit", { code: saved?.code ?? "" }) : t("titleNew")}
        closeLabel={t("close")}
        className="w-[min(100vw-32px,560px)]"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="promo-form">
          <FormField
            id="promo-code"
            label={t("code")}
            error={err("code")}
            hint={used ? t("codeLocked") : t("codeHint", { max: PROMO_CODE_MAX })}
          >
            <div className="flex gap-2">
              <Input
                {...fieldA11y("promo-code", err("code"), true)}
                value={draft.code}
                onChange={(event) => set({ code: event.target.value })}
                onBlur={() => set({ code: normalizePromoCode(draft.code) })}
                disabled={used}
                autoComplete="off"
                spellCheck={false}
                className="uppercase"
              />
              {!used && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => set({ code: generatePromoCode() })}
                  data-testid="promo-generate"
                >
                  <ShuffleIcon aria-hidden />
                  {t("generate")}
                </Button>
              )}
            </div>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="promo-partner" label={t("partnerName")} error={err("partnerName")}>
              <Input
                {...fieldA11y("promo-partner", err("partnerName"))}
                value={draft.partnerName}
                maxLength={PARTNER_NAME_MAX}
                onChange={(event) => set({ partnerName: event.target.value })}
              />
            </FormField>
            <FormField id="promo-email" label={t("partnerEmail")} error={err("partnerEmail")}>
              <Input
                {...fieldA11y("promo-email", err("partnerEmail"))}
                type="email"
                inputMode="email"
                value={draft.partnerEmail}
                onChange={(event) => set({ partnerEmail: event.target.value })}
              />
            </FormField>
          </div>
          <FormField id="promo-note" label={t("partnerNote")}>
            <textarea
              id="promo-note"
              className={textareaClass}
              value={draft.partnerNote}
              maxLength={PARTNER_NOTE_MAX}
              onChange={(event) => set({ partnerNote: event.target.value })}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="promo-kind" label={t("kind")}>
              <SimpleSelect
                id="promo-kind"
                value={draft.kind}
                options={PROMO_KINDS.map((key) => ({ value: key, label: tAll(`kinds.${key}`) }))}
                onChange={(value) => set({ kind: value as PromoKind })}
              />
            </FormField>
            <FormField id="promo-benefit" label={t("benefit")}>
              <SimpleSelect
                id="promo-benefit"
                value={draft.benefit}
                options={PROMO_BENEFITS.map((key) => ({ value: key, label: t(`benefits.${key}`) }))}
                onChange={(value) => set({ benefit: value as PromoBenefitKind })}
              />
            </FormField>
            <FormField
              id="promo-benefit-value"
              label={t(`benefitUnits.${draft.benefit}`)}
              error={err("benefitValue")}
              hint={t("range", { min: limits.min, max: limits.max })}
            >
              <Input
                {...fieldA11y("promo-benefit-value", err("benefitValue"), true)}
                type="number"
                inputMode="numeric"
                min={limits.min}
                max={limits.max}
                value={draft.benefitValue}
                onChange={(event) => set({ benefitValue: event.target.value })}
              />
            </FormField>
          </div>
          {preview && (
            <p className="text-sm text-teal" data-testid="promo-preview">
              {t("preview", { text: preview })}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="promo-commission"
              label={t("commission")}
              error={err("commission")}
              hint={t("commissionHint")}
            >
              <Input
                {...fieldA11y("promo-commission", err("commission"), true)}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={draft.commissionPercent}
                onChange={(event) => set({ commissionPercent: event.target.value })}
              />
            </FormField>
            <FormField
              id="promo-max"
              label={t("maxUses")}
              error={err("maxUses")}
              hint={t("maxUsesHint")}
            >
              <Input
                {...fieldA11y("promo-max", err("maxUses"), true)}
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.maxUses}
                onChange={(event) => set({ maxUses: event.target.value })}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="promo-from" label={t("validFrom")} hint={t("validHint")}>
              <Input
                {...fieldA11y("promo-from", undefined, true)}
                type="date"
                value={draft.validFrom}
                onChange={(event) => set({ validFrom: event.target.value })}
              />
            </FormField>
            <FormField id="promo-to" label={t("validTo")} error={err("validTo")}>
              <Input
                {...fieldA11y("promo-to", err("validTo"))}
                type="date"
                value={draft.validTo}
                onChange={(event) => set({ validTo: event.target.value })}
              />
            </FormField>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <Checkbox
              checked={draft.active}
              onCheckedChange={(checked) => set({ active: checked === true })}
            />
            {t("active")}
          </label>
          {problem && problem !== "invalid" && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
          <Footer>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="promo-save">
              {t("save")}
            </Button>
          </Footer>
        </form>
      </ResponsiveDialog>
    </>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}
