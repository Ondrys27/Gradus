"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  FlagIcon,
  HourglassIcon,
  LightbulbIcon,
  MailPlusIcon,
  MapIcon,
  PhoneCallIcon,
  ReceiptTextIcon,
  SquareCheckBigIcon,
  TrendingDownIcon,
  TrophyIcon,
  Undo2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useWhenLabel } from "@/features/grady/call-window";
import { useDismissSuggestion, useUndoTaskCompletion } from "@/features/grady/queries";
import type { Suggestion } from "@/features/grady/suggestions";
import { isRuleType, type SuggestionType } from "@/features/grady/suggestion-types";
import { formatCurrency, formatNumber, formatSlotMoment, type FormatSettings } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/client";

const ICONS: Record<SuggestionType, LucideIcon> = {
  dealWon: TrophyIcon,
  followUps: PhoneCallIcon,
  stalledDeal: HourglassIcon,
  overdueTask: CalendarClockIcon,
  milestoneReady: FlagIcon,
  overdueInvoice: ReceiptTextIcon,
  overdueCrmTask: SquareCheckBigIcon,
  workerInvite: MailPlusIcon,
  cashLow: TrendingDownIcon,
  bookingPending: CalendarCheckIcon,
  bookingNew: CalendarCheckIcon,
  taskCompleted: CircleCheckIcon,
  insight: LightbulbIcon,
  pathReady: MapIcon,
};

const ICON_TONE: Record<SuggestionType, string> = {
  dealWon: "text-gold",
  followUps: "text-teal",
  stalledDeal: "text-pink",
  overdueTask: "text-pink",
  milestoneReady: "text-gold",
  overdueInvoice: "text-pink",
  overdueCrmTask: "text-pink",
  workerInvite: "text-violet",
  cashLow: "text-orange",
  bookingPending: "text-gold",
  bookingNew: "text-green",
  taskCompleted: "text-green",
  insight: "text-violet",
  pathReady: "text-teal",
};

/**
 * Numbers stay numbers (for plural forms) and get a `<key>Formatted` twin,
 * formatted like everywhere else in the app.
 */
function formatParams(
  params: Record<string, string | number> | undefined,
  settings: FormatSettings,
  uiLocale: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] = value;
    if (typeof value === "number") out[`${key}Formatted`] = formatNumber(value, {}, settings);
  }
  // A booked meeting (bookingPending, bookingNew): its moment as the app writes it.
  if (typeof params?.startsAt === "string" && Number.isFinite(Date.parse(params.startsAt))) {
    out.startsAtFormatted = formatSlotMoment(new Date(params.startsAt), settings, uiLocale);
  }
  // Amounts of the month plan (cashLow) in the plan's own currency.
  if (typeof params?.currency === "string") {
    for (const key of ["threshold", "causeAmount"]) {
      const value = params[key];
      if (typeof value === "number")
        out[`${key}Money`] = formatCurrency(value, params.currency, settings);
    }
  }
  return out;
}

/** The wording of a suggestion: rule ones from the translations, Grady's own as written. */
export function useSuggestionText() {
  const t = useTranslations("grady.suggestion");
  const settings = useFormatSettings();
  const uiLocale = useLocale();
  return useCallback(
    (suggestion: Suggestion) => {
      const params = formatParams(suggestion.action.params, settings, uiLocale);
      if (isRuleType(suggestion.type)) {
        const type = suggestion.type;
        return {
          title:
            type === "dealWon" && !params.contact
              ? t("dealWon.noContact", params)
              : type === "overdueInvoice" && !params.customer
                ? t("overdueInvoice.noCustomer", params)
                : type === "overdueCrmTask" && !params.target
                  ? t("overdueCrmTask.noTarget", params)
                  : type === "workerInvite" && !params.who
                    ? t("workerInvite.noWho", params)
                    : t(`${type}.text`, params),
          detail: null,
          prompt:
            suggestion.action.kind === "ask"
              ? suggestion.action.prompt ||
                (type === "dealWon" || type === "stalledDeal" ? t(`${type}.prompt`, params) : "")
              : "",
        };
      }
      if (suggestion.type === "pathReady") {
        return {
          title: params.first ? t("pathReady.text", params) : t("pathReady.noFirst", params),
          detail: null,
          prompt: "",
        };
      }
      if (suggestion.type === "taskCompleted") {
        return {
          title: t("taskCompleted.text", params),
          detail: suggestion.text,
          prompt: "",
        };
      }
      return {
        title: suggestion.text,
        detail: null,
        prompt: suggestion.action.kind === "ask" ? suggestion.action.prompt : "",
      };
    },
    [t, settings, uiLocale],
  );
}

/**
 * Runs a suggestion's button: opens the place in the app, asks Grady, or
 * takes back a task Grady marked done. The suggestion goes away afterwards.
 */
export function useSuggestionActions(options: {
  ask: (prompt: string) => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const dismiss = useDismissSuggestion();
  const undo = useUndoTaskCompletion();
  const text = useSuggestionText();
  const { ask, onNavigate } = options;

  const run = useCallback(
    async (suggestion: Suggestion) => {
      const action = suggestion.action;
      if (action.kind === "open") {
        router.push(action.href);
        onNavigate?.();
      } else if (action.kind === "ask") {
        const prompt = text(suggestion).prompt || text(suggestion).title;
        ask(prompt);
      } else {
        await undo.mutateAsync({ taskId: action.taskId, previousStatus: action.previousStatus });
      }
      track("jarvis_suggestion_reacted", { reaction: "used", action: action.kind });
      dismiss.mutate([suggestion.id]);
    },
    [router, onNavigate, ask, undo, dismiss, text],
  );

  return {
    run,
    dismiss: (suggestion: Suggestion) => {
      track("jarvis_suggestion_reacted", {
        reaction: "dismissed",
        action: suggestion.action.kind,
      });
      dismiss.mutate([suggestion.id]);
    },
    undoPending: undo.isPending,
    undoFailed: undo.isError,
  };
}

type CardProps = {
  suggestion: Suggestion;
  onRun: (suggestion: Suggestion) => void;
  onDismiss: (suggestion: Suggestion) => void;
  busy?: boolean;
  className?: string;
};

export function SuggestionCard({ suggestion, onRun, onDismiss, busy, className }: CardProps) {
  const t = useTranslations("grady.suggestion");
  const tWindow = useTranslations("grady.callWindow");
  const when = useWhenLabel();
  const text = useSuggestionText()(suggestion);
  const Icon = ICONS[suggestion.type];
  const isUndo = suggestion.action.kind === "undoTask";

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-line bg-surface-hover px-3 py-2.5",
        !suggestion.seen && "border-gold/50",
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[suggestion.type])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm break-words text-ink">{text.title}</p>
        {text.detail && <p className="mt-0.5 text-xs break-words text-ink-muted">{text.detail}</p>}
        {suggestion.notBefore && (
          <p className="mt-0.5 text-xs text-ink-muted">
            {tWindow("suggestionLater", { when: when(new Date(suggestion.notBefore)) })}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onRun(suggestion)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-teal/15 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-teal/25 focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-50 mouse:min-h-8"
          >
            {isUndo && <Undo2Icon aria-hidden className="size-4" />}
            {isUndo ? t("undo") : t("do")}
          </button>
          {isUndo && (
            <button
              type="button"
              onClick={() => onDismiss(suggestion)}
              className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm text-ink-soft outline-none transition-colors hover:bg-surface focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-8"
            >
              {t("keep")}
            </button>
          )}
        </div>
      </div>
      {!isUndo && (
        <button
          type="button"
          onClick={() => onDismiss(suggestion)}
          aria-label={t("dismiss")}
          className="-mt-1.5 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}
