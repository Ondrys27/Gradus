"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarClockIcon,
  CircleCheckIcon,
  FlagIcon,
  HourglassIcon,
  LightbulbIcon,
  PhoneCallIcon,
  TrophyIcon,
  Undo2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useDismissSuggestion, useUndoTaskCompletion } from "@/features/jarvis/queries";
import type { Suggestion } from "@/features/jarvis/suggestions";
import { isRuleType, type SuggestionType } from "@/features/jarvis/suggestion-types";
import { formatNumber, type FormatSettings } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

const ICONS: Record<SuggestionType, LucideIcon> = {
  dealWon: TrophyIcon,
  followUps: PhoneCallIcon,
  stalledDeal: HourglassIcon,
  overdueTask: CalendarClockIcon,
  milestoneReady: FlagIcon,
  taskCompleted: CircleCheckIcon,
  insight: LightbulbIcon,
};

const ICON_TONE: Record<SuggestionType, string> = {
  dealWon: "text-gold",
  followUps: "text-teal",
  stalledDeal: "text-pink",
  overdueTask: "text-pink",
  milestoneReady: "text-gold",
  taskCompleted: "text-green",
  insight: "text-violet",
};

/**
 * Numbers stay numbers (for plural forms) and get a `<key>Formatted` twin,
 * formatted like everywhere else in the app.
 */
function formatParams(
  params: Record<string, string | number> | undefined,
  settings: FormatSettings,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] = value;
    if (typeof value === "number") out[`${key}Formatted`] = formatNumber(value, {}, settings);
  }
  return out;
}

/** The wording of a suggestion: rule ones from the translations, Jarvis's own as written. */
export function useSuggestionText() {
  const t = useTranslations("jarvis.suggestion");
  const settings = useFormatSettings();
  return useCallback(
    (suggestion: Suggestion) => {
      const params = formatParams(suggestion.action.params, settings);
      if (isRuleType(suggestion.type)) {
        const type = suggestion.type;
        return {
          title:
            type === "dealWon" && !params.contact
              ? t("dealWon.noContact", params)
              : t(`${type}.text`, params),
          detail: null,
          prompt:
            suggestion.action.kind === "ask"
              ? suggestion.action.prompt ||
                (type === "dealWon" || type === "stalledDeal" ? t(`${type}.prompt`, params) : "")
              : "",
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
    [t, settings],
  );
}

/**
 * Runs a suggestion's button: opens the place in the app, asks Jarvis, or
 * takes back a task Jarvis marked done. The suggestion goes away afterwards.
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
      dismiss.mutate([suggestion.id]);
    },
    [router, onNavigate, ask, undo, dismiss, text],
  );

  return {
    run,
    dismiss: (suggestion: Suggestion) => dismiss.mutate([suggestion.id]),
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
  const t = useTranslations("jarvis.suggestion");
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
