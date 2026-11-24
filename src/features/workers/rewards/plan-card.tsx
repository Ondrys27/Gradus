"use client";

import { useMemo, useState } from "react";
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useFormatSettings } from "@/lib/use-format-settings";
import { formatCalendarDate } from "@/lib/format";
import { eventMessageKey } from "./catalog";
import { needsReview, type SpaceRefs } from "./definition";
import { bonusProgress } from "./evaluate";
import {
  useCreatePlan,
  useDeleteRule,
  usePlanRefs,
  useRewardEntries,
  useRewardPlan,
  useSaveRule,
  useUpdatePlan,
} from "./queries";
import { RewardSetup } from "./reward-setup";
import { RuleEditor } from "./rule-editor";
import { OverlapNotes } from "./rule-overlap";
import { RuleSentence, type NameOf } from "./rule-sentence";
import { RULES_PER_PLAN } from "./rules";
import { monthBounds } from "./summary";
import { TemplateDialog } from "./template-dialog";
import type { RewardPlan, RewardRule } from "./types";

const NO_REFS: SpaceRefs = { tables: [], stages: [] };

/**
 * "Plan of rewards": the rules of one person as sentences, automatic approval
 * or with approval, validity and currency. The manager builds it with the
 * wizard or a template; the person only reads it.
 */
export function PlanCard({
  workerId,
  editable,
  readOnly,
}: {
  workerId: string;
  /** The viewer manages this person's rewards. */
  editable: boolean;
  /** Read-only mode of the space: seen, not changed. */
  readOnly: boolean;
}) {
  const t = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const query = useRewardPlan(workerId);
  const refs = usePlanRefs(workerId);
  const create = useCreatePlan();
  const [template, setTemplate] = useState(false);
  const canEdit = editable && !readOnly;

  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (query.isPending) return <Skeleton className="h-48 w-full rounded-card" />;
  const plan = query.data;

  if (!plan) {
    return (
      <GlowCard interactive={false} className="flex flex-col gap-4" data-testid="reward-plan-empty">
        <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
        <EmptyState
          icon={<SparklesIcon />}
          title={t("emptyTitle")}
          description={editable ? t("emptyOwner") : t("emptyWorker")}
        />
        {canEdit && (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => setTemplate(true)} data-testid="reward-plan-from-template">
              <SparklesIcon aria-hidden data-icon="inline-start" />
              {t("fromTemplate")}
            </Button>
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={() => create.mutate({ workerId })}
              data-testid="reward-plan-create"
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("createEmpty")}
            </Button>
          </div>
        )}
        {create.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
        {canEdit && (
          <RewardSetup workerId={workerId} plan={null} currency={settings.currency} refs={refs.data ?? NO_REFS} />
        )}
        <TemplateDialog
          open={template}
          onOpenChange={setTemplate}
          workerId={workerId}
          plan={null}
          currency={settings.currency}
          refs={refs.data ?? NO_REFS}
        />
      </GlowCard>
    );
  }

  return <PlanBody plan={plan} canEdit={canEdit} refs={refs.data ?? null} />;
}

function PlanBody({ plan, canEdit, refs }: { plan: RewardPlan; canEdit: boolean; refs: SpaceRefs | null }) {
  const t = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const update = useUpdatePlan();
  const save = useSaveRule();
  const remove = useDeleteRule();
  const range = useMemo(() => monthBounds(settings), [settings]);
  const month = useRewardEntries(plan.worker_id, range);
  const names = useMemo(
    () => new Map([...(refs?.tables ?? []), ...(refs?.stages ?? [])].map((item) => [item.id, item.name])),
    [refs],
  );
  const nameOf: NameOf = (id) => names.get(id) ?? null;
  const [wizard, setWizard] = useState<{ open: boolean; rule: RewardRule | null }>({ open: false, rule: null });
  const [template, setTemplate] = useState(false);
  const [deleting, setDeleting] = useState<RewardRule | null>(null);
  const full = plan.rules.length >= RULES_PER_PLAN;
  const failed = update.isError || save.isError;

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4" data-testid="reward-plan">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
          <p className="text-xs text-ink-muted">
            {plan.active_from || plan.active_to
              ? t("validity", {
                  from: plan.active_from ? formatCalendarDate(plan.active_from, settings) : "…",
                  to: plan.active_to ? formatCalendarDate(plan.active_to, settings) : "…",
                })
              : t("validAlways")}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => setTemplate(true)}
              data-testid="reward-plan-template"
            >
              <SparklesIcon aria-hidden data-icon="inline-start" />
              {t("template")}
            </Button>
            <Button
              size="sm"
              disabled={full}
              onClick={() => setWizard({ open: true, rule: null })}
              data-testid="reward-rule-add"
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("addRule")}
            </Button>
          </div>
        )}
      </div>

      <label className="flex min-h-11 items-center justify-between gap-4 rounded-2xl border border-line px-4 py-2">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-ink">{t("approvalLabel")}</span>
          <span className="text-xs text-ink-muted">
            {plan.approval === "manual" ? t("approvalManual") : t("approvalAuto")}
          </span>
        </span>
        <Switch
          checked={plan.approval === "manual"}
          disabled={!canEdit || update.isPending}
          data-testid="reward-plan-approval"
          onCheckedChange={(manual) =>
            update.mutate({ planId: plan.id, patch: { approval: manual ? "manual" : "auto" } })
          }
        />
      </label>

      {plan.notes && (
        <div className="flex items-start gap-3 rounded-2xl border border-orange/30 bg-orange/10 px-4 py-3">
          <p className="flex-1 text-sm whitespace-pre-line text-ink">{plan.notes}</p>
          {canEdit && (
            <button
              type="button"
              aria-label={t("notesDismiss")}
              onClick={() => update.mutate({ planId: plan.id, patch: { notes: null } })}
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}

      {plan.rules.length === 0 ? (
        <p className="text-sm text-ink-soft">{canEdit ? t("noRulesOwner") : t("noRulesWorker")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60" data-testid="reward-rules">
          {plan.rules.map((rule) => {
            const progress = bonusProgress(rule.definition, month.data ?? [], rule.id);
            return (
            <li key={rule.id} className="flex items-center gap-3 py-2.5" data-testid="reward-rule">
              <RuleSentence
                definition={rule.definition}
                currency={plan.currency}
                nameOf={nameOf}
                muted={!rule.active}
                needsReview={needsReview(rule.definition, refs)}
                className="flex-1"
              >
                {progress && rule.active && (
                  <span className="text-xs text-teal" data-testid="reward-bonus-progress">
                    {progress.reached
                      ? t("bonusReached", { goal: progress.goal })
                      : t("bonusProgress", {
                          done: progress.done,
                          goal: progress.goal,
                          noun: t(`events.${eventMessageKey(rule.definition.event.key)}`),
                        })}
                  </span>
                )}
              </RuleSentence>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={rule.active}
                    aria-label={rule.active ? t("ruleOff") : t("ruleOn")}
                    onCheckedChange={(active) =>
                      save.mutate({ plan, ruleId: rule.id, definition: rule.definition, active })
                    }
                  />
                  <button
                    type="button"
                    aria-label={t("ruleEdit")}
                    onClick={() => setWizard({ open: true, rule })}
                    className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
                  >
                    <PencilIcon aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("ruleDelete")}
                    onClick={() => setDeleting(rule)}
                    className="grid size-11 cursor-pointer place-items-center rounded-full text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
                  >
                    <Trash2Icon aria-hidden className="size-4" />
                  </button>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      <OverlapNotes rules={plan.rules} currency={plan.currency} nameOf={nameOf} canEdit={canEdit} />
      {canEdit && <RewardSetup workerId={plan.worker_id} plan={plan} currency={plan.currency} refs={refs ?? NO_REFS} />}

      {canEdit && (
        <details className="group rounded-2xl border border-line px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-soft outline-none">
            {t("settings")}
          </summary>
          <div className="grid gap-3 pt-2 pb-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-muted">{t("currency")}</span>
              <CurrencyPicker
                id={`reward-plan-currency-${plan.id}`}
                value={plan.currency}
                onChange={(currency) => update.mutate({ planId: plan.id, patch: { currency } })}
                ariaLabel={t("currency")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-muted">{t("activeFrom")}</span>
              <DatePicker
                id={`reward-plan-from-${plan.id}`}
                value={plan.active_from}
                onValueChange={(day) => update.mutate({ planId: plan.id, patch: { active_from: day } })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-muted">{t("activeTo")}</span>
              <DatePicker
                id={`reward-plan-to-${plan.id}`}
                value={plan.active_to}
                onValueChange={(day) => update.mutate({ planId: plan.id, patch: { active_to: day } })}
              />
            </div>
          </div>
          <p className="pb-2 text-xs text-ink-muted">{t("currencyHint")}</p>
        </details>
      )}
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}

      <RuleEditor
        open={wizard.open}
        onOpenChange={(open) => setWizard((current) => ({ ...current, open }))}
        plan={plan}
        rule={wizard.rule}
        refs={refs ?? NO_REFS}
      />
      <TemplateDialog
        open={template}
        onOpenChange={setTemplate}
        workerId={plan.worker_id}
        plan={plan}
        currency={plan.currency}
        refs={refs ?? NO_REFS}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("ruleDelete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("saveFailed") : null}
        onConfirm={() =>
          deleting &&
          remove.mutate(
            { id: deleting.id, definition: deleting.definition },
            { onSuccess: () => setDeleting(null) },
          )
        }
      />
    </GlowCard>
  );
}
