"use client";

import { useState, type FormEvent } from "react";
import { Loader2Icon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { GradyJobError, postGradyJob } from "@/features/grady/queries";
import { cn } from "@/lib/utils";
import { type RuleDefinition, type SpaceRefs } from "./definition";
import { useApplyRuleOps, type RuleOp } from "./queries";
import { useRuleText } from "./rule-sentence";
import { RuleTry } from "./rule-try";
import { RULES_PER_PLAN } from "./rules";
import { SentenceEditor } from "./sentence-editor";
import {
  answeredDefinition,
  REWARD_SETUP_REQUEST_MAX,
  type RewardSetupChange,
  type RewardSetupProposal,
} from "./setup";
import type { RewardPlan } from "./types";

/**
 * "Describe how you reward" (29.1): the owner writes it in their own words,
 * Grady (reward_setup) proposes rules; each shows as an editable sentence
 * with "Try it" on the person's last 30 days, questions are answered by
 * picking, what cannot be said is named with the nearest option. Nothing is
 * saved until "Save the chosen rules".
 */
export function RewardSetup({
  workerId,
  plan,
  currency,
  refs,
}: {
  workerId: string;
  plan: RewardPlan | null;
  currency: string;
  refs: SpaceRefs;
}) {
  const t = useTranslations("workers.rewardPlan.setup");
  const tError = useTranslations("grady.error");
  const [request, setRequest] = useState("");
  const [proposal, setProposal] = useState<RewardSetupProposal | null>(null);
  const suggest = useMutation({
    mutationFn: async (text: string) => {
      const result = await postGradyJob<{ proposal: RewardSetupProposal }>({
        kind: "rewardSetup",
        workerId,
        request: text,
      });
      if (!result.ok) throw new GradyJobError(result.code);
      return result.proposal;
    },
    onSuccess: setProposal,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!request.trim()) return;
    setProposal(null);
    suggest.mutate(request.trim());
  }

  const code = suggest.error instanceof GradyJobError ? suggest.error.code : suggest.error ? "unknown" : null;
  const error =
    code === null
      ? null
      : code === "limitReached" || code === "empty"
        ? t(`errors.${code}`)
        : code === "paused" || code === "userLimit" || code === "spaceLimit" || code === "notConfigured" || code === "network" || code === "busy"
          ? tError(code)
          : tError("unavailable");

  return (
    <details className="group rounded-2xl border border-violet/30 bg-violet/5 px-4 py-2" data-testid="reward-setup" data-tutorial="reward-setup">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink outline-none">
        <SparklesIcon aria-hidden className="size-4 text-violet" />
        {t("title")}
      </summary>
      <form onSubmit={submit} className="flex flex-col gap-3 pt-2 pb-3">
        <FormField id={`reward-setup-${workerId}`} label={t("label")} hint={t("hint")}>
          <Textarea
            value={request}
            rows={3}
            maxLength={REWARD_SETUP_REQUEST_MAX}
            placeholder={t("placeholder")}
            onChange={(event) => setRequest(event.target.value)}
            data-testid="reward-setup-input"
          />
        </FormField>
        <Button type="submit" size="sm" className="self-start" disabled={!request.trim() || suggest.isPending}>
          {suggest.isPending ? (
            <Loader2Icon aria-hidden data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <SparklesIcon aria-hidden data-icon="inline-start" />
          )}
          {t("submit")}
        </Button>
        {error && <FormAlert>{error}</FormAlert>}
      </form>
      {proposal && (
        <Proposal
          key={JSON.stringify(proposal)}
          proposal={proposal}
          workerId={workerId}
          plan={plan}
          currency={currency}
          refs={refs}
          onDone={() => {
            setProposal(null);
            setRequest("");
          }}
        />
      )}
    </details>
  );
}

type Draft = { change: RewardSetupChange; include: boolean; definition: RuleDefinition | null };

function Proposal({
  proposal,
  workerId,
  plan,
  currency,
  refs,
  onDone,
}: {
  proposal: RewardSetupProposal;
  workerId: string;
  plan: RewardPlan | null;
  currency: string;
  refs: SpaceRefs;
  onDone: () => void;
}) {
  const t = useTranslations("workers.rewardPlan.setup");
  const text = useRuleText();
  const apply = useApplyRuleOps();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    proposal.changes.map((change) => ({ change, include: true, definition: null })),
  );
  const names = new Map([...refs.tables, ...refs.stages].map((item) => [item.id, item.name]));
  const nameOf = (id: string) => names.get(id) ?? null;
  const existing = new Map((plan?.rules ?? []).map((rule) => [rule.id, rule]));

  /** The rule as it stands: edited by the owner, or Grady's with the answers put in. */
  const current = (draft: Draft): RuleDefinition | null =>
    draft.change.op === "remove" ? null : (draft.definition ?? answeredDefinition(draft.change, answers));

  const ops: RuleOp[] = drafts.flatMap((draft): RuleOp[] => {
    if (!draft.include) return [];
    if (draft.change.op === "remove") return [{ op: "remove", ruleId: draft.change.ruleId }];
    const definition = current(draft);
    if (!definition) return [];
    return draft.change.op === "update"
      ? [{ op: "update", ruleId: draft.change.ruleId, definition }]
      : [{ op: "add", definition }];
  });
  const waiting = drafts.some((draft) => draft.include && draft.change.op !== "remove" && !current(draft));
  const added = ops.filter((op) => op.op === "add").length - ops.filter((op) => op.op === "remove").length;
  const tooMany = (plan?.rules.length ?? 0) + added > RULES_PER_PLAN;

  async function save() {
    if (!ops.length || waiting || tooMany) return;
    try {
      await apply.mutateAsync({ workerId, plan, currency, ops, from: "plan" });
      onDone();
    } catch {
      // The alert below says it.
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4 pb-3" data-testid="reward-setup-proposal">
      {proposal.questions.map((question) => (
        <fieldset key={question.key} className="flex flex-col gap-1 rounded-2xl border border-gold/30 bg-gold/5 p-3">
          <legend className="px-1 text-sm font-medium text-ink">{question.text}</legend>
          {question.options.map((option) => (
            <label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink mouse:min-h-9">
              <Checkbox
                checked={(answers[question.key] ?? []).includes(option.id)}
                onCheckedChange={(on) =>
                  setAnswers((all) => ({
                    ...all,
                    [question.key]: on
                      ? [...(all[question.key] ?? []), option.id]
                      : (all[question.key] ?? []).filter((id) => id !== option.id),
                  }))
                }
              />
              {nameOf(option.id) ?? option.label}
            </label>
          ))}
        </fieldset>
      ))}

      <ul className="flex flex-col gap-3">
        {drafts.map((draft, index) => {
          const definition = current(draft);
          const change = draft.change;
          const toggle = (include: boolean) =>
            setDrafts((list) => list.map((item, i) => (i === index ? { ...item, include } : item)));
          return (
            <li
              key={index}
              className={cn("flex flex-col gap-3 rounded-2xl border border-line p-3", !draft.include && "opacity-60")}
              data-testid="reward-setup-change"
            >
              <label className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
                <Checkbox checked={draft.include} onCheckedChange={(on) => toggle(on === true)} />
                {t(`op.${change.op}`)}
              </label>
              {change.op === "remove" ? (
                <p className="flex items-start gap-2 text-sm text-ink-soft line-through">
                  <Trash2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-pink" />
                  {existing.get(change.ruleId)
                    ? text(existing.get(change.ruleId)!.definition, currency, nameOf)
                    : t("gone")}
                </p>
              ) : definition ? (
                <>
                  {change.op === "update" && existing.get(change.ruleId) && (
                    <p className="text-xs text-ink-muted line-through">
                      {text(existing.get(change.ruleId)!.definition, currency, nameOf)}
                    </p>
                  )}
                  <SentenceEditor
                    value={definition}
                    onChange={(next) =>
                      setDrafts((list) => list.map((item, i) => (i === index ? { ...item, definition: next } : item)))
                    }
                    currency={currency}
                    refs={refs}
                    testId={`reward-setup-sentence-${index}`}
                  />
                  <RuleTry workerId={workerId} definition={definition} currency={currency} auto />
                </>
              ) : (
                <p className="text-sm text-ink-soft">{t("answerFirst")}</p>
              )}
              {change.why && <p className="text-xs text-ink-muted">{change.why}</p>}
            </li>
          );
        })}
      </ul>

      {proposal.unsupported.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-orange/30 bg-orange/10 px-3 py-2.5">
          <p className="text-sm font-medium text-ink">{t("unsupported")}</p>
          <ul className="flex flex-col gap-1 text-sm text-ink-soft">
            {proposal.unsupported.map((item, index) => (
              <li key={index}>
                {item.text}
                {item.nearest && <span className="text-ink-muted"> · {t("nearest", { nearest: item.nearest })}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tooMany && <FormAlert>{t("tooMany", { max: RULES_PER_PLAN })}</FormAlert>}
      {apply.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("discard")}
        </Button>
        <Button
          type="button"
          disabled={!ops.length || waiting || tooMany || apply.isPending}
          onClick={save}
          data-testid="reward-setup-save"
        >
          {t("save", { count: ops.length })}
        </Button>
      </div>
    </div>
  );
}
