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
import { Grady } from "@/components/grady/grady";
import { Button } from "@/components/ui/button";
import { SatisfactionCard } from "@/features/dashboard/satisfaction-card";
import {
  SURVEY_FIRST_AFTER_DAYS,
  SURVEY_INTERVAL_DAYS,
} from "@/features/dashboard/satisfaction-trigger";
import { gradyOverlay } from "@/features/grady/overlay-store";
import { useGradySuggestions } from "@/features/grady/queries";
import type { Suggestion } from "@/features/grady/suggestions";
import { useNotes } from "@/features/notes/queries";
import { noteHref } from "@/features/notes/work-notes";
import { cn } from "@/lib/utils";
import { allowedQuickActions } from "../access";
import { QUICK_ACTIONS, type QuickActionKey } from "../catalog";
import type { WidgetSize } from "../grid";
import {
  combine,
  defineWidget,
  DetailHeading,
  Empty,
  READY,
  Stack,
  Sub,
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
    <div className="flex min-w-0 flex-col gap-2">
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
    const has = data.length > 0;
    if (size === "M") {
      // The small character beside the field: pleased when he has something, calm otherwise.
      return (
        <div className="flex min-h-0 flex-1 items-center gap-3">
          <Grady size={64} variant="head" state={has ? "happy" : "idle"} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <QuickAsk compact />
            <Sub>{t("suggestions", { count: data.length })}</Sub>
          </div>
        </div>
      );
    }
    return (
      <Stack>
        <div className="flex items-start gap-3">
          <Grady
            size={80}
            variant="full"
            state={has ? "pointing" : "idle"}
            direction="right"
            className="-mt-1"
          />
          <QuickAsk />
        </div>
        {has ? (
          <ul className="flex min-h-0 flex-col divide-y divide-line overflow-hidden">
            {data.slice(0, 3).map((suggestion) => (
              <SuggestionLine key={suggestion.id} suggestion={suggestion} />
            ))}
          </ul>
        ) : (
          <Sub>{t("nothing")}</Sub>
        )}
      </Stack>
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

/** Lines of the note's text under its title: one in S, three in M, nine in L. */
const NOTE_LINES: Record<WidgetSize, string> = {
  S: "line-clamp-1",
  M: "line-clamp-3",
  L: "line-clamp-[9]",
  XL: "line-clamp-[9]",
};

function NoteBody({ size, data }: { size: WidgetSize; data: NoteData }) {
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
      <span className="truncate text-sm font-semibold text-ink">
        {data.note.title || t("untitled")}
      </span>
      {data.note.preview && (
        <span className={cn("text-sm whitespace-pre-line text-ink-soft", NOTE_LINES[size])}>
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

function QuickActions({ size, settings }: { size: WidgetSize; settings: WidgetSettings }) {
  const t = useTranslations("dashboard.widgets.quickActions");
  const access = useWidgetAccess(null);
  const allowed = allowedQuickActions(access);
  const chosen = (Array.isArray(settings.actions) ? settings.actions : []).filter(
    (key): key is QuickActionKey => allowed.includes(key as QuickActionKey),
  );
  const shown = chosen.slice(0, size === "S" || size === "M" ? 4 : 8);
  if (shown.length === 0) {
    return <Empty icon={ZapIcon} title={t("emptyTitle")} hint={t("emptyHint")} compact />;
  }
  return (
    <ul
      className={cn(
        "grid min-h-0 flex-1",
        // S: a 2 × 2 of icon and a tiny label, filling the square.
        size === "S" && "auto-rows-fr grid-cols-2 gap-1.5",
        // M: four buttons in a row; icon over the label while the row is narrow.
        size === "M" && "grid-cols-4 gap-2",
        // L: two columns, every row the same height, the whole card used.
        size !== "S" && size !== "M" && "auto-rows-fr grid-cols-2 gap-2",
      )}
    >
      {shown.map((key) => {
        const Icon = ACTION_ICONS[key];
        return (
          <li key={key} className="flex min-w-0">
            <Link
              href={QUICK_ACTIONS[key].href}
              title={t(`actions.${key}`)}
              aria-label={t(`actions.${key}`)}
              data-testid={`quick-action-${key}`}
              className={cn(
                "flex min-w-0 flex-1 items-center rounded-xl border border-line bg-surface-hover/40 text-ink-soft outline-none hover:border-line-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
                size === "S" && "min-h-10 flex-col justify-center gap-0.5 px-1 py-1",
                size === "M" &&
                  "min-h-11 flex-col justify-center gap-1 px-1 py-1.5 @md:flex-row @md:gap-2 @md:px-3 @md:py-0",
                size !== "S" && size !== "M" && "min-h-11 gap-2 px-3",
              )}
            >
              <Icon aria-hidden className={cn("shrink-0 text-violet", size === "S" ? "size-4" : "size-5")} />
              <span
                className={cn(
                  "line-clamp-1 min-w-0 text-center leading-tight",
                  size === "S" ? "text-[10px]" : "text-xs",
                )}
              >
                {t(`actions.${key}`)}
              </span>
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

/** Between surveys: one calm line with a small face, never an icon alone in the middle. */
function SatisfactionIdle({ size }: { size: WidgetSize }) {
  const t = useTranslations("dashboard.widgets.satisfaction");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <SmileIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{t("emptyTitle")}</p>
      </div>
      <Sub lines={2}>{t("emptyHint")}</Sub>
      {size !== "M" && (
        <Sub lines={2} className="text-xs text-ink-muted">
          {t("why", { first: SURVEY_FIRST_AFTER_DAYS, interval: SURVEY_INTERVAL_DAYS })}
        </Sub>
      )}
    </div>
  );
}

export const satisfactionWidget = defineWidget<true>({
  key: "satisfaction",
  useData: () => READY,
  View: ({ size }) => (
    <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
      <SatisfactionCard empty={<SatisfactionIdle size={size} />} />
    </div>
  ),
  Detail: () => <SatisfactionCard empty={<SatisfactionIdle size="L" />} />,
});
