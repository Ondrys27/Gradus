"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { AI_MODELS, type AiModelKey } from "@/config/costs";
import { COMPARE_MAX_MODELS, estimateCompare } from "@/features/grady/compare/estimate";
import type { CompareFeature } from "@/features/grady/compare/samples";
import { allowedChoices, AUTO, type FeatureChoice } from "@/features/grady/model-settings";
import type { ModelCompareResult } from "@/features/grady/protocol";
import { formatNumber, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "../format-metric";
import type { CompareCatalog } from "../server/ai-compare-data";

type FeatureCatalog = NonNullable<CompareCatalog["features"][CompareFeature]>;

type Cell =
  | { state: "waiting" }
  | { state: "running" }
  | { state: "done"; result: Extract<ModelCompareResult, { ok: true }> }
  | { state: "failed"; code: string; costUsd: number };

const usd = (value: number) => formatUsd(value, ADMIN_FORMAT_SETTINGS);
/** The comparison runs this many answers at once: quick, without crowding the API. */
const CONCURRENCY = 2;

/** The models a job may run on, cheapest first (no "auto": the comparison runs fixed models). */
function modelsOf(feature: CompareFeature): AiModelKey[] {
  const allowed = allowedChoices(feature).filter((choice): choice is AiModelKey => choice !== AUTO);
  return AI_MODELS.filter((model) => allowed.includes(model.key)).map((model) => model.key);
}

/** What is ticked at first: the current model and its neighbours (the chat on auto: Haiku and Sonnet). */
function initialModels(feature: CompareFeature, current: FeatureChoice): AiModelKey[] {
  const models = modelsOf(feature);
  if (current === AUTO) return models.filter((key) => key === "haiku" || key === "sonnet");
  const index = Math.max(0, models.indexOf(current));
  return models.slice(Math.max(0, index - 1), index + 2).slice(0, 3);
}

/**
 * AI and Grady → Models → "Compare models" (step 28.9): the job's samples
 * on the ticked models side by side with the answer, its price, time,
 * format checks and the cheap model's grade. The estimate is on the start
 * button; every answer is one paid call to /api/grady (kind modelCompare)
 * plus its grade. "Use" puts the model into the form and asks to save.
 */
export function ModelCompareDialog({
  open,
  onOpenChange,
  feature,
  featureName,
  current,
  catalog,
  judge,
  readOnly,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: CompareFeature;
  featureName: string;
  current: FeatureChoice;
  catalog: FeatureCatalog;
  judge: AiModelKey;
  readOnly: boolean;
  onUse: (model: AiModelKey) => void;
}) {
  const t = useTranslations("admin.ai.compare");
  const tUnits = useTranslations("admin.units");
  const [models, setModels] = useState<AiModelKey[]>(() => initialModels(feature, current));
  const [samples, setSamples] = useState<string[]>(() => catalog.samples.map((s) => s.id));
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<{ models: AiModelKey[]; samples: string[] } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const modelName = (key: string) => AI_MODELS.find((model) => model.key === key)?.name ?? key;
  const estimate = useMemo(
    () =>
      estimateCompare({
        feature,
        models,
        sampleChars: catalog.samples
          .map((sample, index) => (samples.includes(sample.id) ? catalog.sampleChars[index] : null))
          .filter((chars): chars is number => chars !== null),
        observedOutput: catalog.observedOutput,
        judge,
      }),
    [feature, models, samples, catalog, judge],
  );

  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...list.filter((item) => item !== value), value] : list.filter((item) => item !== value);
  const key = (model: string, sample: string) => `${model}:${sample}`;

  async function run() {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    const order = AI_MODELS.map((model) => model.key).filter((model) => models.includes(model));
    const chosen = catalog.samples.map((s) => s.id).filter((id) => samples.includes(id));
    const jobs = chosen.flatMap((sample) => order.map((model) => ({ model, sample })));
    setRan({ models: order, samples: chosen });
    setCells(Object.fromEntries(jobs.map((job) => [key(job.model, job.sample), { state: "waiting" }])));
    setRunning(true);
    const queue = [...jobs];
    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job || controller.signal.aborted) return;
        const id = key(job.model, job.sample);
        setCells((before) => ({ ...before, [id]: { state: "running" } }));
        let cell: Cell;
        try {
          const response = await fetch("/api/grady", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "modelCompare",
              feature,
              sampleId: job.sample,
              model: job.model,
            }),
            signal: controller.signal,
          });
          const body = (await response.json().catch(() => null)) as ModelCompareResult | null;
          cell =
            body && body.ok
              ? { state: "done", result: body }
              : {
                  state: "failed",
                  code: body && !body.ok ? body.code : "unavailable",
                  costUsd: body && !body.ok ? (body.costUsd ?? 0) : 0,
                };
        } catch {
          if (controller.signal.aborted) return;
          cell = { state: "failed", code: "unavailable", costUsd: 0 };
        }
        setCells((before) => ({ ...before, [id]: cell }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!controller.signal.aborted) setRunning(false);
  }

  function close(next: boolean) {
    if (!next) {
      abort.current?.abort();
      setRunning(false);
    }
    onOpenChange(next);
  }

  const spent = Object.values(cells).reduce(
    (sum, cell) =>
      sum +
      (cell.state === "done"
        ? cell.result.costUsd + cell.result.judgeCostUsd
        : cell.state === "failed"
          ? cell.costUsd
          : 0),
    0,
  );

  /** One column's totals: average grade, checks passed, average time, price of 1,000 calls. */
  function totals(model: AiModelKey) {
    const done = (ran?.samples ?? [])
      .map((sample) => cells[key(model, sample)])
      .filter((cell): cell is Extract<Cell, { state: "done" }> => cell?.state === "done");
    if (!done.length) return null;
    const scores = done.map((cell) => cell.result.judge?.score).filter((v): v is number => !!v);
    const checks = done.flatMap((cell) => cell.result.checks);
    return {
      score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      checks: checks.length ? checks.filter((check) => check.ok).length / checks.length : null,
      durationMs: done.reduce((a, cell) => a + cell.result.durationMs, 0) / done.length,
      perThousand: (done.reduce((a, cell) => a + cell.result.costUsd, 0) / done.length) * 1000,
    };
  }

  const columns = ran?.models ?? [];

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={t("title", { feature: featureName })}
      closeLabel={t("close")}
      className="md:w-[min(100vw-32px,72rem)]"
    >
      <div className="flex flex-col gap-5" data-testid="model-compare">
        <p className="text-sm text-ink-soft">{t("description")}</p>

        <fieldset className="flex flex-col gap-2" disabled={running}>
          <legend className="mb-1 text-sm font-medium text-ink">{t("models")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {modelsOf(feature).map((model) => {
              const checked = models.includes(model);
              return (
                <label key={model} className="flex min-h-11 items-center gap-2 text-sm text-ink mouse:min-h-8">
                  <Checkbox
                    checked={checked}
                    disabled={!checked && models.length >= COMPARE_MAX_MODELS}
                    onCheckedChange={(on) => setModels((list) => toggle(list, model, on === true))}
                  />
                  {modelName(model)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2" disabled={running}>
          <legend className="mb-1 text-sm font-medium text-ink">{t("samples")}</legend>
          <div className="flex flex-col gap-1">
            {catalog.samples.map((sample) => (
              <label key={sample.id} className="flex min-h-11 items-center gap-2 text-sm text-ink mouse:min-h-8">
                <Checkbox
                  checked={samples.includes(sample.id)}
                  onCheckedChange={(on) => setSamples((list) => toggle(list, sample.id, on === true))}
                />
                <span>{sample.label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-muted">{t("samplesHint")}</p>
        </fieldset>

        <div className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
          <p className="text-ink" data-testid="model-compare-estimate">
            {estimate.totalUsd < 0.01
              ? t("estimateTiny", { calls: estimate.calls })
              : t("estimate", { cost: usd(estimate.totalUsd), calls: estimate.calls })}
          </p>
          <p className="text-xs text-ink-muted">{t("estimateHint", { judge: modelName(judge) })}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {ran && (
              <span className="text-xs text-ink-soft" data-testid="model-compare-spent">
                {t("spent", { cost: usd(spent) })}
              </span>
            )}
            <Button
              type="button"
              className="ml-auto"
              disabled={running || !models.length || !samples.length}
              onClick={run}
              data-testid="model-compare-run"
            >
              {running ? t("running") : t(ran ? "runAgain" : "run")}
            </Button>
          </div>
        </div>

        {ran && (
          <div className="-mx-1 overflow-x-auto px-1">
            <div
              className="grid min-w-full gap-3"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(16rem, 1fr))` }}
            >
              {columns.map((model) => {
                const sum = totals(model);
                return (
                  <div
                    key={model}
                    className="flex flex-col gap-2 rounded-xl border border-line p-3"
                    data-testid={`model-compare-column-${model}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{modelName(model)}</span>
                      {model === current && (
                        <span className="text-xs text-ink-muted">{t("current")}</span>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-ink-muted">{t("score")}</dt>
                      <dd className="text-right text-ink tabular-nums">
                        {sum?.score ? formatNumber(sum.score, { decimals: 1 }, ADMIN_FORMAT_SETTINGS) : "–"}
                      </dd>
                      <dt className="text-ink-muted">{t("checksPassed")}</dt>
                      <dd className="text-right text-ink tabular-nums">
                        {sum?.checks === null || !sum
                          ? "–"
                          : formatNumber(sum.checks, { style: "percent", decimals: 0 }, ADMIN_FORMAT_SETTINGS)}
                      </dd>
                      <dt className="text-ink-muted">{t("duration")}</dt>
                      <dd className="text-right text-ink tabular-nums">
                        {sum ? formatMetricValue(sum.durationMs, "ms", tUnits) : "–"}
                      </dd>
                      <dt className="text-ink-muted">{t("perThousand")}</dt>
                      <dd className="text-right text-ink tabular-nums">
                        {sum ? usd(sum.perThousand) : "–"}
                      </dd>
                    </dl>
                    {!readOnly && sum && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={running}
                        onClick={() => onUse(model)}
                        data-testid={`model-compare-use-${model}`}
                      >
                        {t("use", { model: modelName(model) })}
                      </Button>
                    )}
                    {ran.samples.map((sample) => (
                      <CellView
                        key={sample}
                        label={catalog.samples.find((s) => s.id === sample)?.label ?? sample}
                        cell={cells[key(model, sample)] ?? { state: "waiting" }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function CellView({ label, cell }: { label: string; cell: Cell }) {
  const t = useTranslations("admin.ai.compare");
  const tUnits = useTranslations("admin.units");
  return (
    <section className="flex flex-col gap-1.5 border-t border-line/60 pt-2">
      <h4 className="text-xs font-medium text-ink-soft">{label}</h4>
      {cell.state === "waiting" && <p className="text-xs text-ink-muted">{t("waiting")}</p>}
      {cell.state === "running" && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Loader2Icon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("answering")}
        </p>
      )}
      {cell.state === "failed" && <FormAlert>{t(`errors.${errorKey(cell.code)}`)}</FormAlert>}
      {cell.state === "done" && (
        <>
          <div className="max-h-60 overflow-y-auto rounded-lg bg-canvas/60 p-2 text-xs whitespace-pre-wrap text-ink">
            {cell.result.text}
          </div>
          <p className="text-xs text-ink-soft tabular-nums">
            {t("cellFacts", {
              duration: formatMetricValue(cell.result.durationMs, "ms", tUnits),
              perThousand: usd(cell.result.costUsd * 1000),
              tokens: formatNumber(cell.result.outputTokens, {}, ADMIN_FORMAT_SETTINGS),
            })}
          </p>
          <ul className="flex flex-wrap gap-1">
            {cell.result.checks.map((check) => (
              <li
                key={check.key}
                className={cn(
                  "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px]",
                  check.ok ? "border-green/40 text-green" : "border-pink/40 text-pink",
                )}
              >
                {check.ok ? (
                  <CheckIcon aria-hidden className="size-3" />
                ) : (
                  <XIcon aria-hidden className="size-3" />
                )}
                <span>{t(`checks.${check.key}`)}</span>
                <span className="sr-only">{check.ok ? t("checkOk") : t("checkFailed")}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">
            {cell.result.judge
              ? t("judged", { score: cell.result.judge.score, reason: cell.result.judge.reason })
              : t("notJudged")}
          </p>
        </>
      )}
    </section>
  );
}

const ERROR_KEYS = ["paused", "userLimit", "spaceLimit", "busy", "notConfigured", "invalid"] as const;
function errorKey(code: string): (typeof ERROR_KEYS)[number] | "unavailable" {
  return (ERROR_KEYS as readonly string[]).includes(code)
    ? (code as (typeof ERROR_KEYS)[number])
    : "unavailable";
}
