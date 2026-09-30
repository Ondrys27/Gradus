"use client";

import { useState, type FormEvent } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/account/queries";
import { useAwardXp } from "@/features/gamification/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  generateSchema,
  INDUSTRY_MAX,
  LOCATION_MAX,
  PER_REQUEST_MAX,
  type GenerationEvent,
} from "./generation";
import { runGeneration, useGenerationUsage } from "./generation-client";
import { contactKeys } from "./queries";

const DEFAULT_COUNT = 20;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows the Unreached table, where new contacts land. */
  onShowNew: () => void;
};

export function GenerateContactsDialog({ open, onOpenChange, onShowNew }: Props) {
  const t = useTranslations("contacts.generate");
  const generation = useFreshOnOpen(open);
  const [running, setRunning] = useState(false);
  return (
    <ResponsiveDialog
      open={open}
      // A running generation keeps the dialog; it finishes on the server either way.
      onOpenChange={(next) => {
        if (next || !running) onOpenChange(next);
      }}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <GenerateForm
        key={generation}
        onRunningChange={setRunning}
        onDone={() => onOpenChange(false)}
        onShowNew={() => {
          onOpenChange(false);
          onShowNew();
        }}
      />
    </ResponsiveDialog>
  );
}

type Progress = Extract<GenerationEvent, { type: "phase" }>;
type Outcome = Exclude<GenerationEvent, { type: "phase" }>;

function GenerateForm({
  onRunningChange,
  onDone,
  onShowNew,
}: {
  onRunningChange: (running: boolean) => void;
  onDone: () => void;
  onShowNew: () => void;
}) {
  const t = useTranslations("contacts.generate");
  const tCelebration = useTranslations("gamification.celebration.firstContacts");
  const { celebrate } = useCelebration();
  const settings = useFormatSettings();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const usageQuery = useGenerationUsage(true);
  const awardXp = useAwardXp();
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [countText, setCountText] = useState(String(DEFAULT_COUNT));
  const [refused, setRefused] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"industry" | "location", string>>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false);

  const max = usageQuery.data?.max ?? 0;
  const usage = outcome?.usage ?? usageQuery.data?.usage;
  const n = (value: number) => formatNumber(value, {}, settings);

  function applyCount(next: number) {
    if (next > max) {
      setCount(Math.max(max, 1));
      setCountText(String(Math.max(max, 1)));
      setRefused(true);
      setShaking(true);
      return;
    }
    const clean = Math.max(1, next);
    setCount(clean);
    setCountText(String(clean));
    setRefused(false);
  }

  function setBusy(value: boolean) {
    setRunning(value);
    onRunningChange(value);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    const parsed = generateSchema.safeParse({ industry, location, count });
    if (!parsed.success) {
      const found: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "industry" || field === "location") found[field] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    if (count > max) {
      applyCount(count);
      return;
    }
    setErrors({});
    setOutcome(null);
    setProgress(null);
    setBusy(true);
    const last = await runGeneration(parsed.data, (update) => {
      if (update.type === "phase") setProgress(update);
    });
    setBusy(false);
    setProgress(null);
    if (last.type !== "phase") setOutcome(last);
    if (last.type === "done" && last.created > 0) {
      awardXp.mutate(
        { kind: "contacts_generated_first", idempotencyKey: "first" },
        {
          onSuccess: ({ awarded, xp }) => {
            if (awarded) {
              celebrate({
                title: tCelebration("title"),
                subtitle: tCelebration("subtitle", { count: last.created }),
                xp,
              });
            }
          },
        },
      );
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: contactKeys.all(user.id) }),
      usageQuery.refetch(),
    ]);
  }

  /** Which limit stops a bigger number: Google's cap, today's allowance or this month's. */
  function limitMessage() {
    if (!usage || max === PER_REQUEST_MAX)
      return t("limit.perRequest", { max: n(PER_REQUEST_MAX) });
    const dailyLeft = Math.max(0, usage.daily.limit - usage.daily.used);
    const monthlyLeft = Math.max(0, usage.monthly.limit - usage.monthly.used);
    if (monthlyLeft < dailyLeft) return t("limit.monthly", { left: n(monthlyLeft) });
    return t("limit.daily", { left: n(dailyLeft) });
  }

  const industryError = errors.industry && t(`errors.${errors.industry}`);
  const locationError = errors.location && t(`errors.${errors.location}`);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="generate-industry" label={t("industry")} error={industryError}>
        <Input
          {...fieldA11y("generate-industry", industryError)}
          value={industry}
          autoFocus
          maxLength={INDUSTRY_MAX}
          placeholder={t("industryPlaceholder")}
          disabled={running}
          onChange={(event) => setIndustry(event.target.value)}
        />
      </FormField>
      <FormField id="generate-location" label={t("location")} error={locationError}>
        <Input
          {...fieldA11y("generate-location", locationError)}
          value={location}
          maxLength={LOCATION_MAX}
          placeholder={t("locationPlaceholder")}
          disabled={running}
          onChange={(event) => setLocation(event.target.value)}
        />
      </FormField>

      <FormField
        id="generate-count"
        label={t("count")}
        error={refused ? limitMessage() : undefined}
        hint={t("countHint", { max: n(max) })}
      >
        <div
          className={cn("flex items-center gap-2", shaking && "motion-safe:animate-shake")}
          onAnimationEnd={() => setShaking(false)}
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("less")}
            disabled={running || count <= 1}
            onClick={() => applyCount(count - 1)}
          >
            <MinusIcon aria-hidden />
          </Button>
          <Input
            {...fieldA11y("generate-count", refused, true)}
            inputMode="numeric"
            className="w-24 text-center tabular-nums"
            value={countText}
            disabled={running}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              setCountText(digits);
              if (digits) applyCount(Number(digits));
            }}
            onBlur={() => {
              if (!countText) applyCount(1);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("more")}
            disabled={running || max === 0}
            onClick={() => applyCount(count + 1)}
          >
            <PlusIcon aria-hidden />
          </Button>
        </div>
      </FormField>

      {outcome && <OutcomeMessage outcome={outcome} onShowNew={onShowNew} />}
      {usageQuery.isError && <FormAlert>{t("usageFailed")}</FormAlert>}
      {usageQuery.data && max === 0 && !outcome && <FormAlert>{limitMessage()}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={running} onClick={onDone}>
          {outcome?.type === "done" ? t("close") : t("cancel")}
        </Button>
        <ProgressButton
          running={running}
          progress={progress}
          disabled={!usageQuery.data || max === 0}
          label={outcome ? t("again") : t("submit")}
        />
      </div>

      <p className="text-xs text-ink-muted">
        {usage ? (
          t("usage", {
            dailyUsed: n(usage.daily.used),
            dailyLimit: n(usage.daily.limit),
            monthlyUsed: n(usage.monthly.used),
            monthlyLimit: n(usage.monthly.limit),
          })
        ) : (
          <Skeleton inline className="h-4 w-56" />
        )}
      </p>
    </form>
  );
}

/** While it runs, the button fills with progress, a shine travels over it and it names the phase. */
function ProgressButton({
  running,
  progress,
  disabled,
  label,
}: {
  running: boolean;
  progress: Progress | null;
  disabled: boolean;
  label: string;
}) {
  const t = useTranslations("contacts.generate");
  const settings = useFormatSettings();
  const n = (value: number) => formatNumber(value, {}, settings);
  if (!running) {
    return (
      <Button type="submit" disabled={disabled}>
        {label}
      </Button>
    );
  }
  const share = progress ? Math.max(progress.created / progress.target, 0.06) : 0.06;
  const phase = progress
    ? progress.phase === "searching"
      ? t("phase.searching", { page: progress.page })
      : t("phase.saving")
    : t("phase.starting");
  return (
    <Button
      type="submit"
      aria-disabled
      aria-busy
      className="relative min-w-56 cursor-progress overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-teal/35 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(share * 100)}%` }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-linear-to-r from-transparent via-white/30 to-transparent motion-reduce:hidden"
      />
      <span className="relative" role="status">
        {phase}
        {progress &&
          ` · ${t("phase.count", { created: n(progress.created), target: n(progress.target) })}`}
      </span>
    </Button>
  );
}

function OutcomeMessage({ outcome, onShowNew }: { outcome: Outcome; onShowNew: () => void }) {
  const t = useTranslations("contacts.generate");
  if (outcome.type === "done") {
    return (
      <FormAlert tone={outcome.created > 0 ? "success" : "error"}>
        <span className="flex flex-col gap-1.5">
          <span>
            {outcome.created > 0
              ? t("done.created", { count: outcome.created })
              : t("done.nothingNew")}
            {outcome.duplicates > 0 && ` ${t("done.duplicates", { count: outcome.duplicates })}`}
            {outcome.exhausted && ` ${t("done.exhausted")}`}
          </span>
          {outcome.created > 0 && (
            <button
              type="button"
              onClick={onShowNew}
              className="min-h-11 cursor-pointer self-start text-left font-medium underline underline-offset-4 mouse:min-h-0"
            >
              {t("done.show")}
            </button>
          )}
        </span>
      </FormAlert>
    );
  }
  return (
    <FormAlert>
      <span className="flex flex-col gap-1.5">
        <span>{t(`errors.${outcome.code}`)}</span>
        {outcome.created > 0 && <span>{t("partial", { count: outcome.created })}</span>}
        {(outcome.googleMessage || outcome.httpStatus) && (
          <span className="text-xs break-words opacity-80">
            {outcome.httpStatus
              ? t("googleSaysStatus", {
                  status: String(outcome.httpStatus),
                  message: outcome.googleMessage ?? "",
                })
              : t("googleSays", { message: outcome.googleMessage ?? "" })}
          </span>
        )}
      </span>
    </FormAlert>
  );
}
