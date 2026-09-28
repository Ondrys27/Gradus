"use client";

import { AlertTriangleIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import type { RewardProposal } from "./reward-tree";
import { RuleText } from "./rule-text";

type Props = {
  proposal: RewardProposal | null;
  /** Notes that will not be applied because the rules were set up without Jarvis. */
  droppedNotes: string[];
  workerNames: Map<string, string>;
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** What will run: Jarvis's summary, the rules in words, and what could not be set. */
export function ProposalDialog({
  proposal,
  droppedNotes,
  workerNames,
  pending,
  failed,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("workers.rewards.proposal");
  return (
    <ResponsiveDialog
      open={proposal !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {proposal && (
        <div className="flex flex-col gap-5">
          {proposal.summary ? (
            <div className="flex gap-3 rounded-2xl border border-teal/30 bg-teal/5 p-4">
              <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
              <p className="text-sm whitespace-pre-line text-ink">{proposal.summary}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">{t("withoutAi")}</p>
          )}

          {(proposal.ignored.length > 0 || droppedNotes.length > 0) && (
            <div className="flex gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-sm text-gold">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {droppedNotes.length > 0 ? t("notesDropped") : t("ignored")}
                </span>
                <ul className="list-disc pl-4">
                  {[...proposal.ignored, ...droppedNotes].map((text, index) => (
                    <li key={index} className="[overflow-wrap:anywhere]">
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {proposal.rules.map((rule, index) => (
              <li key={index}>
                <RuleText rule={rule} workerNames={workerNames} />
              </li>
            ))}
          </ul>

          <p className="text-xs text-ink-muted">{t("approvalNote")}</p>
          {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("back")}
            </Button>
            <Button onClick={onConfirm} disabled={pending || proposal.rules.length === 0}>
              {t("confirm")}
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}
