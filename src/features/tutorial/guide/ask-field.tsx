"use client";

import { useId, useState } from "react";
import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GuideSection } from "../ui-map/types";
import { guide, type GuideFrom } from "./guide-store";
import { GUIDE_QUESTION_MIN } from "./protocol";
import { QUESTION_MAX } from "./question";

/**
 * "What do you want to ask?" (30.8): the first thing everywhere the guide is
 * offered, with three example questions of the section to start from. Enter
 * asks, Shift+Enter is a new line.
 */
export function AskField({
  section,
  from,
  autoFocus = false,
  examples = true,
  className,
}: {
  section: GuideSection | null;
  from: GuideFrom;
  autoFocus?: boolean;
  examples?: boolean;
  className?: string;
}) {
  const t = useTranslations("tutorial");
  const id = useId();
  const [question, setQuestion] = useState("");
  const ready = question.trim().length >= GUIDE_QUESTION_MIN;
  const send = (text: string) => {
    if (text.trim().length < GUIDE_QUESTION_MIN) return;
    guide.ask(text.trim(), from, section);
  };
  const sample = section ? (["q1", "q2", "q3"] as const).map((q) => t(`guides.${section}.examples.${q}`)) : [];

  return (
    <div className={cn("flex flex-col gap-2", className)} data-guide-ask="">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {t("guide.askLabel")}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          rows={2}
          maxLength={QUESTION_MAX}
          // The field is what the menu opens for: typing starts at once.
          autoFocus={autoFocus}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(question);
            }
          }}
          placeholder={sample[0] ? t("guide.askPlaceholder", { example: sample[0] }) : t("guide.askPlaceholderPlain")}
          data-testid="guide-question"
          className="min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-canvas/60 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-3 focus-visible:ring-teal/50"
        />
        <Button
          type="button"
          size="icon"
          aria-label={t("guide.ask")}
          disabled={!ready}
          onClick={() => send(question)}
          data-testid="guide-ask"
        >
          <SendIcon aria-hidden className="size-4" />
        </Button>
      </div>
      {examples && sample.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-muted">{t("guide.examples")}</p>
          <ul className="flex flex-col gap-1">
            {sample.map((text) => (
              <li key={text}>
                <button
                  type="button"
                  onClick={() => send(text)}
                  className="min-h-11 w-full rounded-lg px-2 py-1.5 text-left text-sm text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-8"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
