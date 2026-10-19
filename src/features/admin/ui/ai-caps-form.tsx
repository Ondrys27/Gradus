"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  aiCapsFormSchema,
  MAX_MONTHLY_USD,
  MAX_USER_USD,
  remainingUsd,
} from "@/features/jarvis/caps";
import { formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { saveAiCaps, type CapsActionResult } from "../server/ai-caps-actions";

const usd = (value: number) =>
  formatNumber(value, { style: "currency", currency: "USD", decimals: 2 }, ADMIN_FORMAT_SETTINGS);

type Field = "monthlyUsd" | "perUserUsd" | "warnPercent";
const FIELDS: Field[] = ["monthlyUsd", "perUserUsd", "warnPercent"];

type Saved = { monthlyUsd: number; perUserUsd: number | null; warnPercent: number };

/** A typed value as the field shows it; the form keeps the text until it is saved. */
const asText = (value: number | null) => (value === null ? "" : String(value));

/**
 * The application-wide AI caps: monthly cap of all accounts, the cap of one
 * user and the warning threshold, each with this month's spend under it.
 * Saving asks for confirmation with every change listed from → to.
 */
export function AiCapsForm({
  saved,
  fromDefaults,
  spentUsd,
  topUserSpentUsd,
  readOnly = false,
}: {
  saved: Saved;
  /** Nothing in the database yet: the values shown are the defaults. */
  fromDefaults: boolean;
  spentUsd: number;
  topUserSpentUsd: number | null;
  /** An admin: the values and meters, no fields and no saving (the owner changes caps). */
  readOnly?: boolean;
}) {
  const t = useTranslations("admin.ai.caps");
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
    monthlyUsd: asText(saved.monthlyUsd),
    perUserUsd: asText(saved.perUserUsd),
    warnPercent: asText(saved.warnPercent),
  });
  const [errors, setErrors] = useState<Field[]>([]);
  const [notice, setNotice] = useState<"saved" | "noChanges" | null>(null);
  const [problem, setProblem] = useState<Exclude<CapsActionResult, { ok: true }>["error"] | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsed = aiCapsFormSchema.safeParse(values);
  const next = parsed.success ? parsed.data : null;
  const changes = next
    ? FIELDS.filter((field) => next[field] !== saved[field]).map((field) => ({
        field,
        from: saved[field],
        to: next[field],
      }))
    : [];

  const show = (field: Field, value: number | null) =>
    value === null ? t("noLimit") : field === "warnPercent" ? `${value} %` : usd(value);

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setProblem(null);
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.path[0] as Field))]);
      return;
    }
    setErrors([]);
    // Saving the same values again would still be audited; with fromDefaults it is the first save.
    if (changes.length === 0 && !fromDefaults) {
      setNotice("noChanges");
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await saveAiCaps(values).catch(
        (): CapsActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblem(result.error);
        if (result.fields) setErrors(result.fields.filter((f): f is Field => FIELDS.includes(f as Field)));
        return;
      }
      setConfirming(false);
      setNotice("saved");
      router.refresh();
    });
  }

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setNotice(null);
  };
  const error = (field: Field, max?: number) =>
    errors.includes(field) ? t(`errors.${field}`, { max: max ? usd(max) : "" }) : undefined;

  const warnAt = saved.monthlyUsd * (saved.warnPercent / 100);

  if (readOnly) {
    const stored = (label: string, value: string) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="stat-number text-lg text-ink">{value}</span>
      </div>
    );
    return (
      <div className="flex flex-col gap-4" data-testid="ai-caps-readonly">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            {stored(t("monthlyLabel"), show("monthlyUsd", saved.monthlyUsd))}
            <Meter
              label={t("monthlyMeter")}
              value={saved.monthlyUsd > 0 ? spentUsd / saved.monthlyUsd : 1}
              primary={t("spentOf", { spent: usd(spentUsd), cap: usd(saved.monthlyUsd) })}
              secondary={t("left", { amount: usd(remainingUsd(saved.monthlyUsd, spentUsd)) })}
            />
          </div>
          <div className="flex flex-col gap-3">
            {stored(t("perUserLabel"), show("perUserUsd", saved.perUserUsd))}
            <span className="text-xs text-ink-soft">
              {t("topUser", { spent: usd(topUserSpentUsd ?? 0) })}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {stored(t("warnLabel"), show("warnPercent", saved.warnPercent))}
            <Meter
              label={t("warnMeter")}
              value={warnAt > 0 ? spentUsd / warnAt : 1}
              primary={t("spentOf", { spent: usd(spentUsd), cap: usd(warnAt) })}
              secondary={
                spentUsd >= warnAt
                  ? t("warningReached")
                  : t("untilWarning", { amount: usd(remainingUsd(warnAt, spentUsd)) })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="ai-caps-form">
      {fromDefaults && <p className="text-xs text-ink-muted">{t("defaults", {
        budget: usd(saved.monthlyUsd),
        percent: saved.warnPercent,
      })}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          <FormField
            id="caps-monthly"
            label={t("monthlyLabel")}
            error={error("monthlyUsd", MAX_MONTHLY_USD)}
            hint={t("monthlyHint", { max: usd(MAX_MONTHLY_USD) })}
          >
            <Input
              {...fieldA11y("caps-monthly", error("monthlyUsd"), true)}
              inputMode="decimal"
              autoComplete="off"
              value={values.monthlyUsd}
              onChange={set("monthlyUsd")}
            />
          </FormField>
          <Meter
            label={t("monthlyMeter")}
            value={saved.monthlyUsd > 0 ? spentUsd / saved.monthlyUsd : 1}
            primary={t("spentOf", { spent: usd(spentUsd), cap: usd(saved.monthlyUsd) })}
            secondary={t("left", { amount: usd(remainingUsd(saved.monthlyUsd, spentUsd)) })}
          />
        </div>

        <div className="flex flex-col gap-3">
          <FormField
            id="caps-per-user"
            label={t("perUserLabel")}
            error={error("perUserUsd", MAX_USER_USD)}
            hint={t("perUserHint", { max: usd(MAX_USER_USD) })}
          >
            <Input
              {...fieldA11y("caps-per-user", error("perUserUsd"), true)}
              inputMode="decimal"
              autoComplete="off"
              value={values.perUserUsd}
              onChange={set("perUserUsd")}
            />
          </FormField>
          {saved.perUserUsd === null ? (
            <div className="flex flex-col gap-1 text-xs text-ink-soft">
              <span className="font-semibold text-ink">{t("noLimit")}</span>
              <span>{t("topUser", { spent: usd(topUserSpentUsd ?? 0) })}</span>
            </div>
          ) : (
            <Meter
              label={t("perUserMeter")}
              value={(topUserSpentUsd ?? 0) / saved.perUserUsd}
              primary={t("spentOf", {
                spent: usd(topUserSpentUsd ?? 0),
                cap: usd(saved.perUserUsd),
              })}
              secondary={t("left", {
                amount: usd(remainingUsd(saved.perUserUsd, topUserSpentUsd ?? 0)),
              })}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <FormField
            id="caps-warn"
            label={t("warnLabel")}
            error={error("warnPercent")}
            hint={t("warnHint")}
          >
            <Input
              {...fieldA11y("caps-warn", error("warnPercent"), true)}
              inputMode="numeric"
              autoComplete="off"
              value={values.warnPercent}
              onChange={set("warnPercent")}
            />
          </FormField>
          <Meter
            label={t("warnMeter")}
            value={warnAt > 0 ? spentUsd / warnAt : 1}
            primary={t("spentOf", { spent: usd(spentUsd), cap: usd(warnAt) })}
            secondary={
              spentUsd >= warnAt
                ? t("warningReached")
                : t("untilWarning", { amount: usd(remainingUsd(warnAt, spentUsd)) })
            }
          />
        </div>
      </div>

      {notice && (
        <p role="status" className="text-sm text-ink-soft">
          {t(notice)}
        </p>
      )}
      {problem && !confirming && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={t("confirmTitle")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-soft">{t("confirmDescription")}</p>
          <ul className="flex flex-col gap-1.5 text-sm" data-testid="ai-caps-changes">
            {(changes.length ? changes : FIELDS.map((field) => ({
              field,
              from: saved[field],
              to: next?.[field] ?? saved[field],
            }))).map((change) => (
              <li key={change.field} className="flex flex-wrap justify-between gap-2">
                <span className="text-ink-soft">{t(`fields.${change.field}`)}</span>
                <span className="font-semibold text-ink tabular-nums">
                  {show(change.field, change.from)} → {show(change.field, change.to)}
                </span>
              </li>
            ))}
          </ul>
          {problem && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={confirm}>
              {t("confirm")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </form>
  );
}

function Meter({
  label,
  value,
  primary,
  secondary,
}: {
  label: string;
  /** Share used, 0–∞. */
  value: number;
  primary: string;
  secondary: string;
}) {
  const tone = value >= 1 ? "danger" : value >= 0.8 ? "reward" : "progress";
  return (
    <div className="flex flex-col gap-1.5">
      <ProgressBar value={Math.min(value, 1) * 100} label={label} tone={tone} size="sm" />
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="font-semibold text-ink tabular-nums">{primary}</span>
        <span className="text-ink-soft tabular-nums">{secondary}</span>
      </div>
    </div>
  );
}
