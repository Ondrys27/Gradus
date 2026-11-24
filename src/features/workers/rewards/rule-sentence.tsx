"use client";

import {
  BriefcaseIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  ClockIcon,
  FileCheckIcon,
  FileTextIcon,
  FlagIcon,
  ListChecksIcon,
  MoveRightIcon,
  PhoneIcon,
  TrophyIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  UserXIcon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { RewardEvent } from "./catalog";
import type { RuleDefinition } from "./definition";
import { buildSentence, type NameOf, type SentencePiece } from "./sentence";

export { PART_KEYS, type NameOf, type PartKey, type SentencePiece } from "./sentence";

export const EVENT_ICON: Record<RewardEvent, LucideIcon> = {
  "contact.moved": MoveRightIcon,
  "meeting.booked": CalendarCheckIcon,
  "meeting.held": CalendarClockIcon,
  "booking.received": CalendarPlusIcon,
  "call.logged": PhoneIcon,
  "contact.created": UserPlusIcon,
  "deal.moved": FlagIcon,
  "deal.won": TrophyIcon,
  "deal.lost": UserXIcon,
  "task.done": ListChecksIcon,
  "milestone.done": BriefcaseIcon,
  "invoice.issued": FileTextIcon,
  "invoice.paid": FileCheckIcon,
  "time.hour": ClockIcon,
  "time.month": CalendarClockIcon,
};

/** The sentence builder in the user's language and formats. */
export function useSentence() {
  const t = useTranslations("workers.rewardPlan.sentence");
  const locale = useLocale();
  const settings = useFormatSettings();
  return (
    definition: RuleDefinition,
    currency: string,
    nameOf: NameOf,
    mode: "read" | "edit" = "read",
  ): SentencePiece[] =>
    buildSentence(definition, {
      t: (key, values) => t(key as never, values as never),
      locale,
      settings,
      currency,
      nameOf,
      mode,
    });
}

/** The whole sentence as one string (the template list, the invite, Grady's summary). */
export function useRuleText() {
  const sentence = useSentence();
  return (definition: RuleDefinition, currency: string, nameOf: NameOf) =>
    sentence(definition, currency, nameOf)
      .map((piece) => piece.text)
      .join("");
}

/** One rule with its icon, for the plan, the worker's page and the invite. */
export function RuleSentence({
  definition,
  currency,
  nameOf,
  muted = false,
  needsReview = false,
  className,
  children,
}: {
  definition: RuleDefinition;
  currency: string;
  nameOf: NameOf;
  /** A rule switched off. */
  muted?: boolean;
  /** A table or stage it points at is gone. */
  needsReview?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslations("workers.rewardPlan");
  const text = useRuleText();
  const Icon = EVENT_ICON[definition.event.key];
  return (
    <div className={cn("flex min-w-0 items-start gap-3", muted && "opacity-55", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-1 pt-1.5">
        <span className="text-sm text-ink">{text(definition, currency, nameOf)}</span>
        {needsReview && (
          <span className="inline-flex items-center gap-1.5 text-xs text-orange" data-testid="reward-rule-needs-review">
            <TriangleAlertIcon aria-hidden className="size-3.5" />
            {t("needsReview")}
          </span>
        )}
        {children}
      </span>
    </div>
  );
}
