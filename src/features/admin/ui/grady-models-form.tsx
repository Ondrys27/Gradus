"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { AI_MODELS, type AiModelKey } from "@/config/costs";
import {
  allowedChoices,
  applyPreset,
  AUTO,
  FEATURE_MODELS,
  largeChoices,
  matchingPreset,
  MODEL_PRESETS,
  SETTABLE_FEATURES,
  type FeatureChoice,
  type GradyModelsForm as FormValues,
  type ModelPreset,
  type SettableFeature,
} from "@/features/grady/model-settings";
import type { GradyFeature } from "@/features/grady/models";
import { aiModelByKey } from "@/features/grady/models";
import { formatCalendarDate, formatNumber, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { saveGradyModels, type ModelsActionResult } from "../server/grady-models-actions";
import type { CompareCatalog } from "../server/ai-compare-data";
import { ModelCompareDialog } from "./model-compare-dialog";
import { applyRecommendations, type ModelRecommendation } from "@/features/grady/savings";
import { isCompareFeatureKey } from "@/features/grady/compare/features";

const usd = (value: number) => formatUsd(value, ADMIN_FORMAT_SETTINGS);
const count = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);
/** A list price per million tokens: two decimals, three where the price has them (0.125). */
const listPrice = (value: number) =>
  formatNumber(
    value,
    { decimals: Math.round(value * 100) === value * 100 ? 2 : 3 },
    ADMIN_FORMAT_SETTINGS,
  );

export type ModelRow = {
  feature: GradyFeature;
  calls: number;
  costUsd: number;
  /** The average price of 1,000 calls; null without calls. */
  perThousandUsd: number | null;
  estimates: Record<AiModelKey, number>;
};

const selectClass =
  "h-11 w-full min-w-40 rounded-lg border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 disabled:opacity-60 mouse:h-9";

/**
 * AI and Grady → Models (step 27.3): the model of each job with what it cost
 * over 30 days and what it would cost on every model, three presets, economy
 * mode by hand and the large model the chat's automatic choice may use for
 * big analyses. Saving asks for confirmation with every change from → to; a
 * limited admin sees the same table without the controls.
 */
export function GradyModelsForm({
  saved,
  fromDefaults,
  rows,
  readOnly = false,
  recommendations = [],
  signalsLoaded = true,
  compare = null,
}: {
  saved: FormValues;
  /** Nothing in the database yet: the values shown are the defaults. */
  fromDefaults: boolean;
  rows: ModelRow[];
  readOnly?: boolean;
  /** "Where to save" (step 28.9). */
  recommendations?: ModelRecommendation[];
  /** The quality signals could be read (the 28.9 migration ran). */
  signalsLoaded?: boolean;
  /** The samples for "Compare models"; null for whoever may not run a comparison. */
  compare?: CompareCatalog | null;
}) {
  const t = useTranslations("admin.ai.models");
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(saved);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<"saved" | "noChanges" | null>(null);
  const [problem, setProblem] = useState<"invalid" | "forbidden" | "failed" | null>(null);
  const [pending, startTransition] = useTransition();
  const [comparing, setComparing] = useState<GradyFeature | null>(null);

  const modelName = (key: string) => aiModelByKey(key)?.name ?? key;
  const choiceLabel = (choice: FeatureChoice) => (choice === AUTO ? t("auto") : modelName(choice));
  const featureName = (feature: GradyFeature) => t(`features.${feature}.name`);

  const changes = useMemo(() => {
    const list: { key: string; label: string; from: string; to: string }[] = [];
    for (const feature of SETTABLE_FEATURES) {
      if (values.features[feature] !== saved.features[feature]) {
        list.push({
          key: feature,
          label: featureName(feature),
          from: choiceLabel(saved.features[feature]),
          to: choiceLabel(values.features[feature]),
        });
      }
    }
    if (values.chatLarge !== saved.chatLarge) {
      const show = (value: AiModelKey | null) => (value ? modelName(value) : t("chatLarge.never"));
      list.push({
        key: "chatLarge",
        label: t("fields.chatLarge"),
        from: show(saved.chatLarge),
        to: show(values.chatLarge),
      });
    }
    if (values.economy !== saved.economy) {
      const show = (value: boolean) => (value ? t("on") : t("off"));
      list.push({
        key: "economy",
        label: t("fields.economy"),
        from: show(saved.economy),
        to: show(values.economy),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels follow the values
  }, [values, saved]);

  const active = matchingPreset(values);

  const update = (next: FormValues) => {
    setValues(next);
    setNotice(null);
    setProblem(null);
  };
  const setFeature = (feature: SettableFeature, choice: FeatureChoice) =>
    update({ ...values, features: { ...values.features, [feature]: choice } });

  /** A recommendation or a compared model, one click: into the form, then the usual confirmation. */
  const applyChoices = (items: Pick<ModelRecommendation, "feature" | "to">[]) => {
    update(applyRecommendations(values, items));
    setConfirming(true);
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (changes.length === 0 && !fromDefaults) {
      setNotice("noChanges");
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await saveGradyModels(values).catch(
        (): ModelsActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setConfirming(false);
      setNotice("saved");
      router.refresh();
    });
  }

  const presetButton = (preset: ModelPreset) => (
    <Button
      key={preset}
      type="button"
      variant={active === preset ? "default" : "outline"}
      aria-pressed={active === preset}
      disabled={readOnly}
      onClick={() => update(applyPreset(values, preset))}
      data-testid={`models-preset-${preset}`}
    >
      {t(`presets.${preset}`)}
    </Button>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="grady-models-form">
      {fromDefaults && <p className="text-xs text-ink-muted">{t("defaults")}</p>}

      {!readOnly && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">{t("presetsLabel")}</span>
          <div className="flex flex-wrap gap-2">{MODEL_PRESETS.map(presetButton)}</div>
          <p className="text-xs text-ink-muted">
            {active ? t(`presetHint.${active}`) : t("presetHint.custom")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line p-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="models-economy" className="text-sm font-medium text-ink">
              {t("economy.label")}
            </label>
            <p id="models-economy-description" className="text-xs text-ink-soft">
              {t("economy.description")}
            </p>
          </div>
          <Switch
            id="models-economy"
            checked={values.economy}
            disabled={readOnly}
            aria-describedby="models-economy-description"
            onCheckedChange={(checked) => update({ ...values, economy: checked })}
          />
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
          <label htmlFor="models-chat-large" className="text-sm font-medium text-ink">
            {t("chatLarge.label")}
          </label>
          <select
            id="models-chat-large"
            className={selectClass}
            value={values.chatLarge ?? ""}
            disabled={readOnly}
            aria-describedby="models-chat-large-hint"
            onChange={(event) =>
              update({
                ...values,
                chatLarge: (event.target.value || null) as AiModelKey | null,
              })
            }
          >
            <option value="">{t("chatLarge.never")}</option>
            {largeChoices().map((key) => (
              <option key={key} value={key}>
                {modelName(key)}
              </option>
            ))}
          </select>
          <p id="models-chat-large-hint" className="text-xs text-ink-soft">
            {t("chatLarge.hint")}
          </p>
        </div>
      </div>

      <SavingsCard
        recommendations={recommendations}
        loaded={signalsLoaded}
        readOnly={readOnly}
        featureName={featureName}
        choiceLabel={choiceLabel}
        onUse={applyChoices}
      />

      {/* The table scrolls on its own on a phone; the page never does. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[56rem] text-sm" data-testid="models-table">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-soft">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("columns.feature")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("columns.model")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("columns.calls")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("columns.perThousand")}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {t("columns.spend")}
              </th>
              {AI_MODELS.map((model) => (
                <th key={model.key} scope="col" className="py-2 pr-3 text-right font-medium">
                  {t("columns.estimate", { model: model.name })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const spec = FEATURE_MODELS[row.feature];
              const settable = !spec.fixed;
              const choice: FeatureChoice = settable
                ? values.features[row.feature as SettableFeature]
                : spec.recommended;
              const changed =
                settable &&
                values.features[row.feature as SettableFeature] !==
                  saved.features[row.feature as SettableFeature];
              return (
                <tr
                  key={row.feature}
                  className="border-b border-line/60 align-top"
                  data-testid={`models-row-${row.feature}`}
                >
                  <td className="py-3 pr-3">
                    <div className="flex max-w-80 flex-col gap-0.5">
                      <span className="font-medium text-ink">{featureName(row.feature)}</span>
                      <span className="text-xs text-ink-soft">{t(`features.${row.feature}.does`)}</span>
                      <span className="text-xs text-ink-muted">
                        {t("recommended", {
                          model: choiceLabel(spec.recommended),
                          why: t(`features.${row.feature}.why`),
                        })}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    {settable && !readOnly ? (
                      <div className="flex flex-col gap-1">
                        <select
                          className={cn(selectClass, changed && "border-violet")}
                          aria-label={t("modelFor", { feature: featureName(row.feature) })}
                          value={choice}
                          onChange={(event) =>
                            setFeature(
                              row.feature as SettableFeature,
                              event.target.value as FeatureChoice,
                            )
                          }
                        >
                          {allowedChoices(row.feature).map((option) => (
                            <option key={option} value={option}>
                              {choiceLabel(option)}
                            </option>
                          ))}
                        </select>
                        {spec.minimum !== "haiku" && (
                          <span className="text-xs text-ink-muted">
                            {t("minimum", { model: modelName(spec.minimum) })}
                          </span>
                        )}
                        {compare && isCompareFeatureKey(row.feature) && compare.features[row.feature] && (
                          <button
                            type="button"
                            className="min-h-11 self-start text-left text-xs text-violet underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 focus-visible:outline-none mouse:min-h-0"
                            onClick={() => setComparing(row.feature)}
                            data-testid={`models-compare-${row.feature}`}
                          >
                            {t("compareButton")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink">
                        {settable ? choiceLabel(choice) : t("fixed", { model: choiceLabel(choice) })}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">{count(row.calls)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {row.perThousandUsd === null ? "–" : usd(row.perThousandUsd)}
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold tabular-nums">
                    {usd(row.costUsd)}
                  </td>
                  {AI_MODELS.map((model) => (
                    <td key={model.key} className="py-3 pr-3 text-right text-ink-soft tabular-nums">
                      {usd(row.estimates[model.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">{t("estimatesNote")}</p>

      {notice && (
        <p role="status" className="text-sm text-ink-soft">
          {t(notice)}
        </p>
      )}
      {problem && !confirming && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      )}

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={t("confirmTitle")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-soft">{t("confirmDescription")}</p>
          {changes.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="models-changes">
              {changes.map((change) => (
                <li key={change.key} className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-soft">{change.label}</span>
                  <span className="font-semibold text-ink">
                    {change.from} → {change.to}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink" data-testid="models-changes">
              {t("firstSave")}
            </p>
          )}
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

      {compare && comparing && isCompareFeatureKey(comparing) && compare.features[comparing] && (
        <ModelCompareDialog
          open
          onOpenChange={(open) => !open && setComparing(null)}
          feature={comparing}
          featureName={featureName(comparing)}
          current={values.features[comparing as SettableFeature]}
          catalog={compare.features[comparing]!}
          judge={compare.judge}
          readOnly={readOnly}
          onUse={(model) => {
            setComparing(null);
            applyChoices([{ feature: comparing as SettableFeature, to: model }]);
          }}
        />
      )}
    </form>
  );
}

/**
 * "Where to save" (step 28.9): per job a cheaper model where the answers
 * hold up, a better one where people ask again or answers fail, the chat's
 * automatic choice where it is fixed on a bigger model; one click each.
 */
function SavingsCard({
  recommendations,
  loaded,
  readOnly,
  featureName,
  choiceLabel,
  onUse,
}: {
  recommendations: ModelRecommendation[];
  loaded: boolean;
  readOnly: boolean;
  featureName: (feature: GradyFeature) => string;
  choiceLabel: (choice: FeatureChoice) => string;
  onUse: (items: Pick<ModelRecommendation, "feature" | "to">[]) => void;
}) {
  const t = useTranslations("admin.ai.models.savings");
  const percent = (value: number) =>
    formatNumber(value, { style: "percent", decimals: 0 }, ADMIN_FORMAT_SETTINGS);
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-line p-3"
      aria-labelledby="models-savings-title"
      id="kde-usetrit"
      data-testid="models-savings"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id="models-savings-title" className="text-sm font-semibold text-ink">
            {t("title")}
          </h3>
          <p className="text-xs text-ink-soft">{t("description")}</p>
        </div>
        {!readOnly && recommendations.length > 1 && (
          <Button type="button" variant="outline" onClick={() => onUse(recommendations)}>
            {t("useAll")}
          </Button>
        )}
      </div>
      {!loaded ? (
        <p className="text-sm text-ink-muted">{t("notLoaded")}</p>
      ) : recommendations.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recommendations.map((item) => (
            <li
              key={item.feature}
              className="flex flex-col gap-2 rounded-lg bg-canvas/50 p-2.5 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`models-savings-${item.feature}`}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-ink">
                  <span className="font-medium">{featureName(item.feature)}</span>
                  {": "}
                  {choiceLabel(item.from)} → {choiceLabel(item.to)}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    item.monthlyUsd !== null && item.monthlyUsd < 0 ? "text-orange" : "text-green",
                  )}
                >
                  {item.monthlyUsd === null
                    ? t("amountUnknown")
                    : item.monthlyUsd >= 0
                      ? t("saves", { cost: usd(item.monthlyUsd) })
                      : t("costsMore", { cost: usd(-item.monthlyUsd) })}
                </span>
                <span className="text-xs text-ink-soft">
                  {item.reasons
                    .map((reason) =>
                      t(`reasons.${reason.key}`, {
                        percent: reason.share === null ? "" : percent(reason.share),
                      }),
                    )
                    .join(" ")}
                </span>
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onUse([item])}
                  data-testid={`models-savings-use-${item.feature}`}
                >
                  {t("use")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The models offered, their API ids, list prices and when they were checked. */
export function ModelPriceList() {
  const t = useTranslations("admin.ai.models.prices");
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[40rem] text-sm" data-testid="models-prices">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-soft">
            <th scope="col" className="py-2 pr-3 font-medium">{t("model")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("id")}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t("input")}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cacheWrite")}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cacheRead")}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t("output")}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t("verified")}</th>
          </tr>
        </thead>
        <tbody>
          {AI_MODELS.map((model) => (
            <tr key={model.key} className="border-b border-line/60">
              <td className="py-2 pr-3 text-ink">{model.name}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-soft">{model.id}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{listPrice(model.price.input)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{listPrice(model.price.cacheWrite)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{listPrice(model.price.cacheRead)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{listPrice(model.price.output)}</td>
              <td className="py-2 pr-3 text-ink-soft">
                {formatCalendarDate(model.verifiedOn, ADMIN_FORMAT_SETTINGS)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
