"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { definitionErrors, newDefinition, normalizeDefinition, rulesOverlap, type RuleDefinition, type SpaceRefs } from "./definition";
import { useSaveRule, useSetRulesStack } from "./queries";
import { StackChoice } from "./rule-overlap";
import { useRuleText } from "./rule-sentence";
import { RuleTry } from "./rule-try";
import { SentenceEditor } from "./sentence-editor";
import type { RewardPlan, RewardRule } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Pick<RewardPlan, "id" | "worker_id" | "rules" | "currency">;
  /** Editing this rule; a new one when null. */
  rule: RewardRule | null;
  refs: SpaceRefs;
};

/** A new rule starts as the most common one: any move into "Meeting scheduled", the first time only. */
export function starterDefinition(refs: SpaceRefs): RuleDefinition {
  const definition = newDefinition("contact.moved");
  const meeting = refs.tables.find((table) => table.system_key === "meeting_scheduled");
  definition.event.to = { mode: "only", ids: meeting ? [meeting.id] : [] };
  return definition;
}

/** A rule as a sentence with clickable parts, "Try it" and the rules it overlaps. */
export function RuleEditor({ open, onOpenChange, plan, rule, refs }: Props) {
  const t = useTranslations("workers.rewardPlan.editor");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,640px)]"
    >
      <EditorBody key={generation} plan={plan} rule={rule} refs={refs} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function EditorBody({
  plan,
  rule,
  refs,
  onDone,
}: {
  plan: Props["plan"];
  rule: RewardRule | null;
  refs: SpaceRefs;
  onDone: () => void;
}) {
  const t = useTranslations("workers.rewardPlan.editor");
  const text = useRuleText();
  const save = useSaveRule();
  const stack = useSetRulesStack();
  const [definition, setDefinition] = useState<RuleDefinition>(() => rule?.definition ?? starterDefinition(refs));
  const [failed, setFailed] = useState(false);
  const errors = definitionErrors(definition);
  const names = new Map([...refs.tables, ...refs.stages].map((item) => [item.id, item.name]));
  const others = plan.rules.filter(
    (item) => item.id !== rule?.id && item.active && rulesOverlap(item.definition, normalizeDefinition(definition)),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (errors.length) return;
    setFailed(false);
    try {
      await save.mutateAsync({ plan, ruleId: rule?.id ?? null, definition, active: rule?.active ?? true });
      // "Only the highest" holds only when every rule that can pay the event says so.
      const mismatched = others.filter((item) => item.definition.stack !== definition.stack);
      if (mismatched.length) await stack.mutateAsync({ rules: mismatched, stack: definition.stack });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="reward-rule-editor">
      <SentenceEditor value={definition} onChange={setDefinition} currency={plan.currency} refs={refs} />

      {others.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-orange/30 bg-orange/10 px-3 py-2.5" data-testid="reward-overlap">
          <p className="text-sm text-ink">{t("overlap", { count: others.length })}</p>
          <ul className="flex flex-col gap-1 text-xs text-ink-soft">
            {others.map((item) => (
              <li key={item.id}>{text(item.definition, plan.currency, (id) => names.get(id) ?? null)}</li>
            ))}
          </ul>
          <StackChoice value={definition.stack} onChange={(next) => setDefinition({ ...definition, stack: next })} />
        </div>
      )}

      <RuleTry workerId={plan.worker_id} definition={definition} currency={plan.currency} />

      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={errors.length > 0 || save.isPending} data-testid="reward-rule-save">
          {rule ? t("save") : t("addRule")}
        </Button>
      </div>
    </form>
  );
}
