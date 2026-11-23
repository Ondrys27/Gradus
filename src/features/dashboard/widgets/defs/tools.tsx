"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  CalendarPlusIcon,
  FlagIcon,
  ListPlusIcon,
  NotebookPenIcon,
  PinIcon,
  PlayIcon,
  SendIcon,
  SmileIcon,
  SparklesIcon,
  SquareKanbanIcon,
  UserPlusIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SatisfactionCard } from "@/features/dashboard/satisfaction-card";
import { gradyOverlay } from "@/features/grady/overlay-store";
import { useGradySuggestions } from "@/features/grady/queries";
import type { Suggestion } from "@/features/grady/suggestions";
import { useNotes } from "@/features/notes/queries";
import { noteHref } from "@/features/notes/work-notes";
import { cn } from "@/lib/utils";
import { allowedQuickActions } from "../access";
import { QUICK_ACTIONS, type QuickActionKey } from "../catalog";
import {
  combine,
  defineWidget,
  DetailHeading,
  Empty,
  READY,
  type WidgetQuery,
  type WidgetSettings,
} from "../kit";
import { useWidgetAccess } from "../use-widget-access";

// ---------------------------------------------------------------------------
// Grady: what he has ready for you, and a quick question that opens his panel
// ---------------------------------------------------------------------------

const PROMPTS = ["today", "pipeline", "followUp"] as const;

function QuickAsk({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("dashboard.widgets.grady");
  const [text, setText] = useState("");
  // Grady's panel opens and the question goes out as if typed there.
  function ask(prompt: string) {
    const value = prompt.trim();
    if (!value) return;
    gradyOverlay.ask(value);
    setText("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    ask(text);
  }
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          maxLength={500}
          data-testid="widget-grady-input"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30"
        />
        <Button type="submit" size="icon" aria-label={t("send")} disabled={!text.trim()}>
          <SendIcon aria-hidden />
        </Button>
      </form>
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {PROMPTS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => ask(t(`prompts.${key}`))}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft outline-none hover:border-line-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              {t(`prompts.${key}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionLine({ suggestion }: { suggestion: Suggestion }) {
  const href = suggestion.action.kind === "open" ? suggestion.action.href : null;
  const body = <span className="line-clamp-2 text-sm text-ink">{suggestion.text}</span>;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-violet" />
      {href ? (
        <Link
          href={href}
          className="min-w-0 outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function useGradyData(): WidgetQuery<Suggestion[]> {
  const suggestions = useGradySuggestions();
  return combine([suggestions], () => suggestions.data ?? []);
}

export const gradyWidget = defineWidget<Suggestion[]>({
  key: "grady",
  useData: useGradyData,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.grady");
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <QuickAsk compact={size === "M"} />
        {size === "L" &&
          (data.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("nothing")}</p>
          ) : (
            <ul className="flex min-h-0 flex-col divide-y divide-line overflow-hidden">
              {data.slice(0, 3).map((suggestion) => (
                <SuggestionLine key={suggestion.id} suggestion={suggestion} />
              ))}
            </ul>
          ))}
      </div>
    );
  },
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.grady");
    return (
      <div className="flex flex-col gap-4">
        <QuickAsk />
        <DetailHeading>{t("ready")}</DetailHeading>
        {data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("nothing")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.map((suggestion) => (
              <SuggestionLine key={suggestion.id} suggestion={suggestion} />
            ))}
          </ul>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// A pinned note (the chosen one, or the first pinned)
// ---------------------------------------------------------------------------

type NoteData = { note: { id: string; title: string; preview: string | null } | null };

function usePinnedNote(settings: WidgetSettings): WidgetQuery<NoteData> {
  const notes = useNotes();
  return combine([notes], () => {
    const list = notes.data ?? [];
    const chosen =
      (typeof settings.note === "string" && list.find((note) => note.id === settings.note)) ||
      list.find((note) => note.pinned) ||
      null;
    return {
      note: chosen ? { id: chosen.id, title: chosen.title, preview: chosen.preview } : null,
    };
  });
}

function NoteBody({ size, data }: { size: string; data: NoteData }) {
  const t = useTranslations("dashboard.widgets.pinnedNote");
  if (!data.note) {
    return (
      <Empty
        icon={PinIcon}
        tone="violet"
        title={t("emptyTitle")}
        hint={size === "S" ? undefined : t("emptyHint")}
        action={{ label: t("open"), href: "/app/poznamky" }}
        compact={size !== "L"}
      />
    );
  }
  return (
    <Link
      href={noteHref(data.note.id)}
      className="flex min-h-0 flex-col gap-1 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      <span className="line-clamp-2 text-sm font-semibold text-ink">
        {data.note.title || t("untitled")}
      </span>
      {size !== "S" && data.note.preview && (
        <span
          className={cn(
            "text-sm whitespace-pre-line text-ink-soft",
            size === "L" ? "line-clamp-[9]" : "line-clamp-2",
          )}
        >
          {data.note.preview}
        </span>
      )}
    </Link>
  );
}

export const pinnedNoteWidget = defineWidget<NoteData>({
  key: "pinnedNote",
  useData: usePinnedNote,
  View: NoteBody,
  Detail: ({ data }) => <NoteBody size="L" data={data} />,
  useHref: (settings) =>
    typeof settings.note === "string" ? noteHref(settings.note) : "/app/poznamky",
});

// ---------------------------------------------------------------------------
// Quick actions: the person's own choice, each only with its right
// ---------------------------------------------------------------------------

const ACTION_ICONS: Record<QuickActionKey, LucideIcon> = {
  newContact: UserPlusIcon,
  newDeal: SquareKanbanIcon,
  newTask: ListPlusIcon,
  newEvent: CalendarPlusIcon,
  newMilestone: FlagIcon,
  newNote: NotebookPenIcon,
  startTimer: PlayIcon,
  generateContacts: SparklesIcon,
};

function QuickActions({ size, settings }: { size: string; settings: WidgetSettings }) {
  const t = useTranslations("dashboard.widgets.quickActions");
  const access = useWidgetAccess(null);
  const allowed = allowedQuickActions(access);
  const chosen = (Array.isArray(settings.actions) ? settings.actions : []).filter(
    (key): key is QuickActionKey => allowed.includes(key as QuickActionKey),
  );
  const shown = chosen.slice(0, size === "S" ? 4 : size === "M" ? 4 : 8);
  if (shown.length === 0) {
    return <Empty icon={ZapIcon} title={t("emptyTitle")} hint={t("emptyHint")} compact />;
  }
  return (
    <ul
      className={cn(
        "grid gap-2",
        size === "S" ? "grid-cols-2" : size === "M" ? "grid-cols-4" : "grid-cols-2",
      )}
    >
      {shown.map((key) => {
        const Icon = ACTION_ICONS[key];
        return (
          <li key={key}>
            <Link
              href={QUICK_ACTIONS[key].href}
              title={t(`actions.${key}`)}
              aria-label={t(`actions.${key}`)}
              data-testid={`quick-action-${key}`}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-line bg-surface-hover/40 text-ink-soft outline-none hover:border-line-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
                size === "L"
                  ? "min-h-11 px-3"
                  : "aspect-square flex-col justify-center p-1 @[11rem]:aspect-auto @[11rem]:min-h-11",
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-violet" />
              {size !== "S" && <span className="line-clamp-1 text-xs">{t(`actions.${key}`)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const quickActionsWidget = defineWidget<true>({
  key: "quickActions",
  useData: () => READY,
  View: ({ size, settings }) => <QuickActions size={size} settings={settings} />,
  Detail: ({ settings }) => <QuickActions size="L" settings={settings} />,
});

// ---------------------------------------------------------------------------
// Satisfaction survey (the former card): shown when due
// ---------------------------------------------------------------------------

function SatisfactionEmpty() {
  const t = useTranslations("dashboard.widgets.satisfaction");
  return <Empty icon={SmileIcon} tone="green" title={t("emptyTitle")} hint={t("emptyHint")} />;
}

export const satisfactionWidget = defineWidget<true>({
  key: "satisfaction",
  useData: () => READY,
  View: () => (
    <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
      <SatisfactionCard empty={<SatisfactionEmpty />} />
    </div>
  ),
  Detail: () => <SatisfactionCard empty={<SatisfactionEmpty />} />,
});
