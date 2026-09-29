"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CircleCheckIcon, Undo2Icon, XIcon } from "lucide-react";
import { useMarkSuggestionsSeen } from "@/features/jarvis/queries";
import type { Suggestion } from "@/features/jarvis/suggestions";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useSuggestionActions, useSuggestionText } from "./suggestion-card";

/**
 * Announces a task Jarvis marked done, right above his button, with Undo.
 * Closing it marks the announcement seen; the card stays in the panel until
 * the user keeps or undoes the change.
 */
export function AutoActionNotice({
  suggestions,
  onOpenPanel,
}: {
  suggestions: Suggestion[];
  onOpenPanel: () => void;
}) {
  const t = useTranslations("jarvis.suggestion");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const markSeen = useMarkSuggestionsSeen();
  const text = useSuggestionText();
  const actions = useSuggestionActions({ ask: () => undefined });
  const [first] = suggestions;
  const more = suggestions.length - 1;
  const { title, detail } = text(first);

  return (
    <motion.div
      role="status"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="fixed right-[max(16px,env(safe-area-inset-right))] bottom-[calc(12px+64px+16px+env(safe-area-inset-bottom))] z-40 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-green/40 bg-surface p-3 shadow-popover md:right-[max(24px,env(safe-area-inset-right))] md:bottom-[calc(max(24px,env(safe-area-inset-bottom))+64px+16px)]"
    >
      <div className="flex items-start gap-2.5">
        <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-green" />
        <div className="min-w-0 flex-1">
          <p className="text-sm break-words text-ink">{title}</p>
          {detail && <p className="mt-0.5 text-xs break-words text-ink-muted">{detail}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actions.undoPending}
              onClick={() => void actions.run(first).catch(() => undefined)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-teal/15 px-3.5 text-sm font-medium text-ink outline-none hover:bg-teal/25 focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-50 mouse:min-h-8"
            >
              <Undo2Icon aria-hidden className="size-4" />
              {t("undo")}
            </button>
            {more > 0 && (
              <button
                type="button"
                onClick={onOpenPanel}
                className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm text-ink-soft outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-8"
              >
                {t("more", { count: more, formatted: formatNumber(more, {}, settings) })}
              </button>
            )}
          </div>
          {actions.undoFailed && <p className="mt-1 text-xs text-pink">{t("undoFailed")}</p>}
        </div>
        <button
          type="button"
          onClick={() => markSeen.mutate(suggestions.map((item) => item.id))}
          aria-label={t("closeNotice")}
          className="-mt-1.5 -mr-1.5 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}
