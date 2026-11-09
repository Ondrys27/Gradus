"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import {
  CATALOG_LOCALES,
  OPTIONAL_LIMITS,
  PLAN_LIMIT_KEYS,
  type CatalogAddOn,
  type PlanCatalog,
} from "@/config/pricing";
import { SortableList } from "@/features/contacts/sortable-list";
import {
  ADD_ON_DESCRIPTION_MAX,
  ADD_ON_NAME_MAX,
  diffAddOns,
  diffPlanCatalogs,
  FEATURE_MAX,
  MAX_FEATURES,
  MAX_PRICE_CURRENCIES,
  NAME_MAX,
  TAGLINE_MAX,
  validatePlanAddOns,
  validatePlanCatalog,
  type CatalogIssue,
} from "@/features/plan/catalog";
import { manualDeviation, MANUAL_DEVIATION_WARN } from "@/features/plan/localized";
import { BASE_CURRENCY, currencyDisplayName } from "@/lib/currency";
import type { RateTable } from "@/lib/exchange-rates";
import { formatDateTime, formatNumber, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import {
  addCurrency,
  featureId,
  formCurrencies,
  fromAddOnsForm,
  fromForm,
  moveCard,
  moveFeature,
  parseAmount,
  removeCurrency,
  setRecommended,
  toAddOnsForm,
  toForm,
  type FormAddOn,
  type FormMoney,
  type FormPlan,
} from "../plans-form";
import type { PlanImpact } from "../server/plans-data";
import {
  discardPlanDraft,
  planCatalogImpact,
  publishPlanCatalog,
  savePlanDraft,
  type PlansActionError,
} from "../server/plans-actions";
import { PlanChanges } from "./plans-changes";
import { PlansPreview, type DerivedPrices, type PreviewMessages } from "./plans-preview";

type Published = { id: string; catalog: PlanCatalog; addOns: CatalogAddOn[] };
/** `addOns` null: a draft saved before step 24.1, without add-ons stored (saving adds them). */
type Draft = { catalog: PlanCatalog; addOns: CatalogAddOn[] | null; createdAt: string };
type Notice = "saved" | "discarded" | "published" | "noChanges";
type Valid = { catalog: PlanCatalog; addOns: CatalogAddOn[] };
type Form = { plans: FormPlan[]; addOns: FormAddOn[] };

const when = (iso: string) => formatDateTime(new Date(iso), ADMIN_FORMAT_SETTINGS);

/** JSON with the keys of every object sorted, so the order of currencies never counts. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

const formOf = (catalog: PlanCatalog, addOns: readonly CatalogAddOn[]): Form => ({
  plans: toForm(catalog, addOns),
  addOns: toAddOnsForm(addOns, catalog),
});

/**
 * The draft of the plan catalog: the three cards side by side as on the
 * website, every value editable in place, lines added, removed and dragged,
 * the cards moved left and right. Under them the live preview in Czech and
 * English. Saving keeps a draft (nothing published); publishing first shows
 * what changes against the published version and whom it touches.
 */
export function PlansEditor({
  published,
  draft,
  rates,
  previewMessages,
}: {
  published: Published;
  draft: Draft | null;
  /** The day's exchange rates: derived prices in the preview and the 15 % warning. */
  rates: RateTable;
  previewMessages: PreviewMessages;
}) {
  const t = useTranslations("admin.plans");
  const router = useRouter();
  const [form, setFormState] = useState<Form>(() =>
    formOf(draft?.catalog ?? published.catalog, draft?.addOns ?? published.addOns),
  );
  const [saved, setSaved] = useState<Draft | null>(draft);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [problem, setProblem] = useState<PlansActionError | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [confirming, setConfirming] = useState<(Valid & { impact: PlanImpact[] | null }) | null>(null);
  const [pending, startTransition] = useTransition();

  const validation = useMemo(() => validatePlanCatalog(fromForm(form.plans)), [form.plans]);
  const addOnsValidation = useMemo(() => validatePlanAddOns(fromAddOnsForm(form.addOns)), [form.addOns]);
  const valid: Valid | null =
    validation.ok && addOnsValidation.ok ? { catalog: validation.catalog, addOns: addOnsValidation.addOns } : null;
  const issues = [
    ...(validation.ok ? [] : validation.issues),
    ...(addOnsValidation.ok ? [] : addOnsValidation.issues),
  ];
  const baseline: Valid = saved
    ? { catalog: saved.catalog, addOns: saved.addOns ?? published.addOns }
    : { catalog: published.catalog, addOns: published.addOns };
  const dirty = !valid || !same(valid, baseline);
  const currencies = formCurrencies(form.plans);

  const issueAt = (path: string) =>
    showErrors ? issues.find((issue) => issue.path === path) : undefined;

  const setForm = (change: (current: Form) => Form) => {
    setFormState(change);
    setNotice(null);
  };
  const setPlans = (change: (plans: FormPlan[]) => FormPlan[]) =>
    setForm((current) => ({ ...current, plans: change(current.plans) }));
  const update = (index: number, change: (plan: FormPlan) => FormPlan) =>
    setPlans((plans) => plans.map((plan, i) => (i === index ? change(plan) : plan)));
  const updateAddOn = (index: number, change: (addOn: FormAddOn) => FormAddOn) =>
    setForm((current) => ({
      ...current,
      addOns: current.addOns.map((addOn, i) => (i === index ? change(addOn) : addOn)),
    }));
  const setManual = (currency: string, prices?: DerivedPrices) =>
    setForm((current) => addCurrency(current, currency, prices));

  function fail(error: PlansActionError) {
    setProblem(error);
    if (error === "invalid") setShowErrors(true);
  }

  const savedAsValid = (draft: Draft | null) =>
    draft && draft.addOns !== null && valid ? same(valid, { catalog: draft.catalog, addOns: draft.addOns }) : false;

  /** Saves when something changed; returns the plans and add-ons as the draft holds them. */
  async function persist(): Promise<Valid | null> {
    if (!valid) {
      setShowErrors(true);
      setProblem("invalid");
      return null;
    }
    if (saved && saved.addOns && savedAsValid(saved)) return { catalog: saved.catalog, addOns: saved.addOns };
    const result = await savePlanDraft(valid.catalog, valid.addOns).catch(
      () => ({ ok: false, error: "failed" }) as const,
    );
    if (!result.ok) {
      fail(result.error);
      return null;
    }
    setSaved((current) => ({
      catalog: result.catalog,
      addOns: result.addOns,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    }));
    return { catalog: result.catalog, addOns: result.addOns };
  }

  function save() {
    setNotice(null);
    setProblem(null);
    startTransition(async () => {
      if (savedAsValid(saved)) {
        setNotice("noChanges");
        return;
      }
      if (await persist()) {
        setNotice("saved");
        router.refresh();
      }
    });
  }

  function discard() {
    setProblem(null);
    startTransition(async () => {
      const result = await discardPlanDraft().catch(() => ({ ok: false, error: "failed" }) as const);
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setDiscarding(false);
      setSaved(null);
      setFormState(formOf(published.catalog, published.addOns));
      setShowErrors(false);
      setNotice("discarded");
      router.refresh();
    });
  }

  function askPublish() {
    setNotice(null);
    setProblem(null);
    startTransition(async () => {
      const version = await persist();
      if (!version) return;
      setConfirming({ ...version, impact: null });
      const result = await planCatalogImpact(version.catalog).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      setConfirming((current) =>
        current && current.catalog === version.catalog
          ? { ...version, impact: result.ok ? result.impact : [] }
          : current,
      );
    });
  }

  function publish() {
    if (!confirming) return;
    startTransition(async () => {
      const result = await publishPlanCatalog(confirming.catalog, confirming.addOns, published.id).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setConfirming(null);
      setSaved(null);
      setNotice("published");
      router.refresh();
    });
  }

  const unchanged = confirming
    ? diffPlanCatalogs(published.catalog, confirming.catalog).length === 0 &&
      diffAddOns(published.addOns, confirming.addOns).length === 0
    : false;

  return (
    <div className="flex flex-col gap-6" data-testid="plans-editor">
      <ManualCurrencies
        currencies={currencies}
        onAdd={(currency) => setManual(currency)}
        onRemove={(currency) => setForm((current) => removeCurrency(current, currency))}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {form.plans.map((plan, index) => (
          <PlanCardEditor
            key={plan.key}
            plan={plan}
            index={index}
            count={form.plans.length}
            currencies={currencies}
            rates={rates}
            issueAt={issueAt}
            onChange={(change) => update(index, change)}
            onMove={(step) => setPlans((current) => moveCard(current, index, step))}
            onRecommended={(on) => setPlans((current) => setRecommended(current, plan.key, on))}
          />
        ))}
      </div>
      {form.addOns.length > 0 && (
        <AddOnsEditor
          addOns={form.addOns}
          currencies={currencies}
          rates={rates}
          issueAt={issueAt}
          onChange={updateAddOn}
        />
      )}
      {showErrors && issues.some((issue) => issue.path === "catalog") && (
        <FormAlert>{t(`errors.${issues.find((issue) => issue.path === "catalog")!.code}`)}</FormAlert>
      )}

      <div
        className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 backdrop-blur lg:bottom-4"
        data-testid="plans-actions"
      >
        <p className="min-w-0 flex-1 text-xs text-ink-soft" role="status">
          {notice
            ? t(`notices.${notice}`)
            : dirty
              ? t("status.unsaved")
              : saved
                ? t("status.draft", { date: when(saved.createdAt) })
                : t("status.noDraft")}
        </p>
        <div className="flex flex-wrap gap-2">
          {saved && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setDiscarding(true)}>
              {t("actions.discard")}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={pending} onClick={save}>
            {t("actions.save")}
          </Button>
          <Button type="button" disabled={pending} onClick={askPublish}>
            {t("actions.publish")}
          </Button>
        </div>
        {problem && !confirming && (
          <div className="basis-full">
            <FormAlert>{t(`problems.${problem}`)}</FormAlert>
          </div>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] leading-5 font-semibold text-ink">{t("preview.title")}</h2>
        <PlansPreview
          catalog={valid?.catalog ?? null}
          addOns={valid?.addOns ?? []}
          rates={rates}
          messages={previewMessages}
          onSetManual={setManual}
        />
      </section>

      <ConfirmDialog
        open={discarding}
        onOpenChange={(open) => !pending && setDiscarding(open)}
        title={t("discardConfirm.title")}
        description={t("discardConfirm.description")}
        confirmLabel={t("discardConfirm.confirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={pending}
        error={problem ? t(`problems.${problem}`) : null}
        onConfirm={discard}
      />

      <ResponsiveDialog
        open={confirming !== null}
        onOpenChange={(open) => !pending && !open && setConfirming(null)}
        title={t("publishConfirm.title")}
        closeLabel={t("close")}
      >
        {confirming && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink-soft">{t("publishConfirm.description")}</p>
            <div className="max-h-[50vh] overflow-y-auto">
              <PlanChanges
                from={published.catalog}
                to={confirming.catalog}
                impact={confirming.impact}
                addOns={{ from: published.addOns, to: confirming.addOns }}
              />
            </div>
            {problem && <FormAlert>{t(`problems.${problem}`)}</FormAlert>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                {t("cancel")}
              </Button>
              <Button type="button" disabled={pending || unchanged} onClick={publish}>
                {t("publishConfirm.confirm")}
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}

type IssueAt = (path: string) => CatalogIssue | undefined;

function PlanCardEditor({
  plan,
  index,
  count,
  currencies,
  rates,
  issueAt,
  onChange,
  onMove,
  onRecommended,
}: {
  plan: FormPlan;
  index: number;
  count: number;
  currencies: readonly string[];
  rates: RateTable;
  issueAt: IssueAt;
  onChange: (change: (plan: FormPlan) => FormPlan) => void;
  onMove: (step: -1 | 1) => void;
  onRecommended: (on: boolean) => void;
}) {
  const t = useTranslations("admin.plans");
  const id = (path: string) => `plan-${plan.key}-${path.replace(/\./g, "-")}`;
  const message = (path: string, max?: number) => {
    const issue = issueAt(`${plan.key}.${path}`);
    return issue ? t(`errors.${issue.code}`, { max: max ?? 0 }) : undefined;
  };
  const title = plan.name.cs || plan.key;

  const text = (field: "name" | "tagline", max: number) =>
    CATALOG_LOCALES.map((locale) => {
      const path = `${field}.${locale}`;
      const error = message(path, max);
      return (
        <FormField key={path} id={id(path)} label={t(`card.${field}`, { locale: locale.toUpperCase() })} error={error}>
          <Input
            {...fieldA11y(id(path), error)}
            value={plan[field][locale]}
            maxLength={max + 20}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                [field]: { ...current[field], [locale]: event.target.value },
              }))
            }
          />
        </FormField>
      );
    });

  const money = (field: "monthly" | "yearly" | "per_worker", currency: string) => {
    const path = `${field}.${currency}`;
    return (
      <MoneyField
        key={path}
        id={id(path)}
        label={`${t(`fields.${field}`)} (${currency})`}
        currency={currency}
        money={plan[field]}
        rates={rates}
        error={message(path)}
        onChange={(value) =>
          onChange((current) => ({
            ...current,
            [field]: { ...current[field], [currency]: value },
          }))
        }
      />
    );
  };
  const prices = (fields: readonly ("monthly" | "yearly" | "per_worker")[]) =>
    currencies.map((currency) => (
      <div key={currency} className="grid grid-cols-2 gap-3" data-testid={`plan-${plan.key}-prices-${currency}`}>
        {fields.map((field) => money(field, currency))}
      </div>
    ));

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border bg-surface p-4",
        plan.recommended ? "border-violet/70" : "border-line",
      )}
      data-testid={`plan-card-${plan.key}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("card.moveLeft", { name: title })}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("card.moveRight", { name: title })}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </header>

      <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-soft">
        {t("card.recommended")}
        <Switch checked={plan.recommended} onCheckedChange={(on) => onRecommended(on)} />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {text("name", NAME_MAX)}
        {text("tagline", TAGLINE_MAX)}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">{t("card.prices")}</legend>
        {message("yearly") && <p className="text-xs text-pink">{message("yearly")}</p>}
        {prices(["monthly", "yearly"])}
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-soft">
          {t("card.perWorker")}
          <Switch
            checked={plan.perWorkerOn}
            onCheckedChange={(on) => onChange((current) => ({ ...current, perWorkerOn: on }))}
          />
        </label>
        {plan.perWorkerOn && (
          <>
            {message("per_worker") && <p className="text-xs text-pink">{message("per_worker")}</p>}
            <div className="grid grid-cols-2 gap-3">
              {currencies.map((currency) => money("per_worker", currency))}
            </div>
          </>
        )}
        <FormField
          id={id("included_workers")}
          label={t("fields.included_workers")}
          hint={t("card.includedWorkersHint")}
          error={message("included_workers")}
        >
          <Input
            {...fieldA11y(id("included_workers"), message("included_workers"))}
            inputMode="numeric"
            autoComplete="off"
            value={plan.included_workers}
            onChange={(event) =>
              onChange((current) => ({ ...current, included_workers: event.target.value }))
            }
          />
        </FormField>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">{t("card.limits")}</legend>
        <div className="grid grid-cols-2 gap-3">
          {PLAN_LIMIT_KEYS.map((limit) => {
            const path = `limits.${limit}`;
            const error = message(path);
            const optional = OPTIONAL_LIMITS.includes(limit);
            return (
              <FormField key={limit} id={id(path)} label={t(`limits.${limit}`)} error={error}>
                <Input
                  {...fieldA11y(id(path), error)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={optional ? t("card.unlimited") : undefined}
                  value={plan.limits[limit]}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      limits: { ...current.limits, [limit]: event.target.value },
                    }))
                  }
                />
              </FormField>
            );
          })}
        </div>
        <p className="text-xs text-ink-muted">{t("card.limitsHint")}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">{t("card.features")}</legend>
        <SortableList
          items={plan.features}
          nameOf={(feature) => feature.cs || feature.en || t("card.emptyLine")}
          onReorder={(from, to) =>
            onChange((current) => ({ ...current, features: moveFeature(current.features, from, to) }))
          }
          renderItem={(feature, handle) => {
            const line = plan.features.indexOf(feature);
            const setLine = (patch: Partial<typeof feature>) =>
              onChange((current) => ({
                ...current,
                features: current.features.map((item) =>
                  item.id === feature.id ? { ...item, ...patch } : item,
                ),
              }));
            return (
              <div className="flex items-start gap-1 rounded-xl border border-line bg-canvas p-1.5">
                {handle}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {CATALOG_LOCALES.map((locale) => {
                    const path = `features.${line}.${locale}`;
                    const error = message(path, FEATURE_MAX);
                    const label = t("card.line", { n: line + 1, locale: locale.toUpperCase() });
                    return (
                      <div key={locale} className="flex flex-col gap-1">
                        <Input
                          {...fieldA11y(id(path), error)}
                          aria-label={label}
                          placeholder={locale.toUpperCase()}
                          value={feature[locale]}
                          onChange={(event) => setLine({ [locale]: event.target.value })}
                        />
                        {error && (
                          <p id={`${id(path)}-message`} className="text-xs text-pink">
                            {error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("card.highlight", { n: line + 1 })}
                    aria-pressed={feature.highlight}
                    onClick={() => setLine({ highlight: !feature.highlight })}
                  >
                    <StarIcon
                      aria-hidden
                      className={cn(feature.highlight ? "fill-gold text-gold" : "text-ink-muted")}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("card.remove", { n: line + 1 })}
                    onClick={() =>
                      onChange((current) => ({
                        ...current,
                        features: current.features.filter((item) => item.id !== feature.id),
                      }))
                    }
                  >
                    <Trash2Icon aria-hidden className="text-destructive" />
                  </Button>
                </div>
              </div>
            );
          }}
        />
        {message("features", MAX_FEATURES) && (
          <p className="text-xs text-pink">{message("features", MAX_FEATURES)}</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={plan.features.length >= MAX_FEATURES}
          onClick={() =>
            onChange((current) => ({
              ...current,
              features: [...current.features, { id: featureId(), cs: "", en: "", highlight: false }],
            }))
          }
        >
          <PlusIcon aria-hidden />
          {t("card.addLine")}
        </Button>
        <p className="text-xs text-ink-muted">
          {t("card.placeholders", { list: PLAN_LIMIT_KEYS.map((key) => `{${key}}`).join(", ") })}
        </p>
      </fieldset>
    </article>
  );
}

/**
 * A price field. A manual price (any currency but EUR) more than 15 % from
 * the EUR price at the day's rate gets a warning under it; the rate never
 * changes it.
 */
function MoneyField({
  id,
  label,
  currency,
  money,
  rates,
  error,
  onChange,
}: {
  id: string;
  label: string;
  currency: string;
  money: FormMoney;
  rates: RateTable;
  error?: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("admin.plans.card");
  const eur = parseAmount(money[BASE_CURRENCY] ?? "");
  const manual = parseAmount(money[currency] ?? "");
  const deviation =
    currency !== BASE_CURRENCY && eur !== null && eur > 0 && manual !== null && manual > 0
      ? manualDeviation({ EUR: eur, [currency]: manual }, currency, rates)
      : null;
  const warn = !error && deviation !== null && Math.abs(deviation) > MANUAL_DEVIATION_WARN;
  const exact = eur !== null && deviation !== null && manual !== null ? manual / (1 + deviation) : null;
  return (
    <FormField
      id={id}
      label={label}
      error={error}
      hint={
        warn && exact !== null ? (
          <span className="flex items-start gap-1 text-gold" data-testid="plan-price-deviation">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t(deviation > 0 ? "deviationAbove" : "deviationBelow", {
              percent: formatNumber(Math.abs(deviation), { style: "percent", decimals: 0 }, ADMIN_FORMAT_SETTINGS),
              exact: formatPrice(Math.round(exact * 100) / 100, currency, ADMIN_FORMAT_SETTINGS),
            })}
          </span>
        ) : undefined
      }
    >
      <Input
        {...fieldA11y(id, error)}
        inputMode="decimal"
        autoComplete="off"
        placeholder={currency === BASE_CURRENCY ? undefined : t("derivedPlaceholder")}
        value={money[currency] ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

/**
 * The currencies with a manual price besides EUR, for the whole catalog: one
 * added here gets fields on every card and add-on; removing it derives its
 * prices from EUR again.
 */
function ManualCurrencies({
  currencies,
  onAdd,
  onRemove,
}: {
  currencies: readonly string[];
  onAdd: (currency: string) => void;
  onRemove: (currency: string) => void;
}) {
  const t = useTranslations("admin.plans.currencies");
  const locale = useLocale();
  const manual = currencies.filter((currency) => currency !== BASE_CURRENCY);
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
      data-testid="plans-manual-currencies"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] leading-5 font-semibold text-ink">{t("title")}</h2>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </div>
      <ul className="flex flex-wrap items-center gap-2">
        <li className="flex min-h-11 items-center rounded-full border border-line bg-canvas px-3 text-sm text-ink mouse:min-h-9">
          {t("base", { currency: BASE_CURRENCY })}
        </li>
        {manual.map((currency) => (
          <li
            key={currency}
            className="flex min-h-11 items-center gap-1 rounded-full border border-violet/40 bg-violet/10 pr-1 pl-3 text-sm text-ink mouse:min-h-9"
            title={currencyDisplayName(currency, locale)}
          >
            {currency}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("remove", { currency })}
              onClick={() => onRemove(currency)}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        ))}
        {currencies.length < MAX_PRICE_CURRENCIES && (
          <li>
            <CurrencyPicker
              id="plans-add-currency"
              value={BASE_CURRENCY}
              ariaLabel={t("add")}
              compact
              onChange={(currency) => {
                if (!currencies.includes(currency)) onAdd(currency);
              }}
              className="min-w-32"
            />
          </li>
        )}
      </ul>
      <p className="text-xs text-ink-muted">{t("hint")}</p>
    </section>
  );
}

/** The add-ons of the catalog: names, descriptions and the monthly price in each currency. */
function AddOnsEditor({
  addOns,
  currencies,
  rates,
  issueAt,
  onChange,
}: {
  addOns: readonly FormAddOn[];
  currencies: readonly string[];
  rates: RateTable;
  issueAt: IssueAt;
  onChange: (index: number, change: (addOn: FormAddOn) => FormAddOn) => void;
}) {
  const t = useTranslations("admin.plans");
  return (
    <section className="flex flex-col gap-3" data-testid="plans-add-ons">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] leading-5 font-semibold text-ink">{t("addOns.title")}</h2>
        <p className="text-sm text-ink-soft">{t("addOns.description")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {addOns.map((addOn, index) => {
          const id = (path: string) => `addon-${addOn.key}-${path.replace(/\./g, "-")}`;
          const message = (path: string, max?: number) => {
            const issue = issueAt(`${addOn.key}.${path}`);
            return issue ? t(`errors.${issue.code}`, { max: max ?? 0 }) : undefined;
          };
          const text = (field: "name" | "description", max: number) =>
            CATALOG_LOCALES.map((locale) => {
              const path = `${field}.${locale}`;
              const error = message(path, max);
              return (
                <FormField
                  key={path}
                  id={id(path)}
                  label={t(`addOns.${field === "description" ? "descriptionLabel" : "name"}`, { locale: locale.toUpperCase() })}
                  error={error}
                >
                  <Input
                    {...fieldA11y(id(path), error)}
                    value={addOn[field][locale]}
                    maxLength={max + 20}
                    onChange={(event) =>
                      onChange(index, (current) => ({
                        ...current,
                        [field]: { ...current[field], [locale]: event.target.value },
                      }))
                    }
                  />
                </FormField>
              );
            });
          return (
            <article
              key={addOn.key}
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
              data-testid={`addon-card-${addOn.key}`}
            >
              <h3 className="truncate text-base font-semibold text-ink">{addOn.name.cs || addOn.key}</h3>
              {text("name", ADD_ON_NAME_MAX)}
              {text("description", ADD_ON_DESCRIPTION_MAX)}
              <div className="grid grid-cols-2 gap-3">
                {currencies.map((currency) => {
                  const path = `monthly.${currency}`;
                  return (
                    <MoneyField
                      key={path}
                      id={id(path)}
                      label={`${t("fields.monthly")} (${currency})`}
                      currency={currency}
                      money={addOn.monthly}
                      rates={rates}
                      error={message(path)}
                      onChange={(value) =>
                        onChange(index, (current) => ({
                          ...current,
                          monthly: { ...current.monthly, [currency]: value },
                        }))
                      }
                    />
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
