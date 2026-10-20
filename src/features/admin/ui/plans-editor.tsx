"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import {
  CATALOG_LOCALES,
  OPTIONAL_LIMITS,
  PLAN_LIMIT_KEYS,
  PRICE_CURRENCIES,
  type PlanCatalog,
} from "@/config/pricing";
import { SortableList } from "@/features/contacts/sortable-list";
import {
  diffPlanCatalogs,
  FEATURE_MAX,
  MAX_FEATURES,
  NAME_MAX,
  TAGLINE_MAX,
  validatePlanCatalog,
  type CatalogIssue,
} from "@/features/plan/catalog";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import {
  featureId,
  fromForm,
  moveCard,
  moveFeature,
  setRecommended,
  toForm,
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
import { PlansPreview, type PreviewMessages } from "./plans-preview";

type Published = { id: string; catalog: PlanCatalog };
type Draft = { catalog: PlanCatalog; createdAt: string };
type Notice = "saved" | "discarded" | "published" | "noChanges";

const when = (iso: string) => formatDateTime(new Date(iso), ADMIN_FORMAT_SETTINGS);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  previewMessages,
}: {
  published: Published;
  draft: Draft | null;
  previewMessages: PreviewMessages;
}) {
  const t = useTranslations("admin.plans");
  const router = useRouter();
  const start = draft?.catalog ?? published.catalog;
  const [form, setForm] = useState<FormPlan[]>(() => toForm(start));
  const [saved, setSaved] = useState<Draft | null>(draft);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [problem, setProblem] = useState<PlansActionError | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [confirming, setConfirming] = useState<{ catalog: PlanCatalog; impact: PlanImpact[] | null } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const payload = useMemo(() => fromForm(form), [form]);
  const validation = useMemo(() => validatePlanCatalog(payload), [payload]);
  const valid = validation.ok ? validation.catalog : null;
  const issues = validation.ok ? [] : validation.issues;
  const baseline = saved?.catalog ?? published.catalog;
  const dirty = !valid || !same(valid, baseline);

  const issueAt = (path: string) =>
    showErrors ? issues.find((issue) => issue.path === path) : undefined;

  const update = (index: number, change: (plan: FormPlan) => FormPlan) => {
    setForm((current) => current.map((plan, i) => (i === index ? change(plan) : plan)));
    setNotice(null);
  };

  function fail(error: PlansActionError) {
    setProblem(error);
    if (error === "invalid") setShowErrors(true);
  }

  /** Saves when something changed; returns the catalog as the draft holds it. */
  async function persist(): Promise<PlanCatalog | null> {
    if (!valid) {
      setShowErrors(true);
      setProblem("invalid");
      return null;
    }
    if (saved && same(valid, saved.catalog)) return saved.catalog;
    const result = await savePlanDraft(valid).catch(
      () => ({ ok: false, error: "failed" }) as const,
    );
    if (!result.ok) {
      fail(result.error);
      return null;
    }
    setSaved((current) => ({
      catalog: result.catalog,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    }));
    return result.catalog;
  }

  function save() {
    setNotice(null);
    setProblem(null);
    startTransition(async () => {
      if (valid && saved && same(valid, saved.catalog)) {
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
      setForm(toForm(published.catalog));
      setShowErrors(false);
      setNotice("discarded");
      router.refresh();
    });
  }

  function askPublish() {
    setNotice(null);
    setProblem(null);
    startTransition(async () => {
      const catalog = await persist();
      if (!catalog) return;
      setConfirming({ catalog, impact: null });
      const result = await planCatalogImpact(catalog).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      setConfirming((current) =>
        current && current.catalog === catalog
          ? { catalog, impact: result.ok ? result.impact : [] }
          : current,
      );
    });
  }

  function publish() {
    if (!confirming) return;
    startTransition(async () => {
      const result = await publishPlanCatalog(confirming.catalog, published.id).catch(
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

  const unchanged = confirming ? diffPlanCatalogs(published.catalog, confirming.catalog).length === 0 : false;

  return (
    <div className="flex flex-col gap-6" data-testid="plans-editor">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {form.map((plan, index) => (
          <PlanCardEditor
            key={plan.key}
            plan={plan}
            index={index}
            count={form.length}
            issueAt={issueAt}
            onChange={(change) => update(index, change)}
            onMove={(step) => setForm((current) => moveCard(current, index, step))}
            onRecommended={(on) => setForm((current) => setRecommended(current, plan.key, on))}
          />
        ))}
      </div>
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
        <PlansPreview catalog={valid} messages={previewMessages} />
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
              <PlanChanges from={published.catalog} to={confirming.catalog} impact={confirming.impact} />
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
  issueAt,
  onChange,
  onMove,
  onRecommended,
}: {
  plan: FormPlan;
  index: number;
  count: number;
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

  const money = (field: "monthly" | "yearly" | "per_worker") =>
    PRICE_CURRENCIES.map((currency) => {
      const path = `${field}.${currency}`;
      const error = message(path);
      return (
        <FormField key={path} id={id(path)} label={`${t(`fields.${field}`)} (${currency})`} error={error}>
          <Input
            {...fieldA11y(id(path), error)}
            inputMode="decimal"
            autoComplete="off"
            value={plan[field][currency]}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                [field]: { ...current[field], [currency]: event.target.value },
              }))
            }
          />
        </FormField>
      );
    });

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
        <div className="grid grid-cols-2 gap-3">
          {money("monthly")}
          {money("yearly")}
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-soft">
          {t("card.perWorker")}
          <Switch
            checked={plan.perWorkerOn}
            onCheckedChange={(on) => onChange((current) => ({ ...current, perWorkerOn: on }))}
          />
        </label>
        {plan.perWorkerOn && <div className="grid grid-cols-2 gap-3">{money("per_worker")}</div>}
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
