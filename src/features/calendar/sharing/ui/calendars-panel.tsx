"use client";

import { useState } from "react";
import { CalendarHeartIcon, CalendarSearchIcon, PaletteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toneFill } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { GRADUS_SOURCE, PERSON_TONES, type PersonTone, type VisiblePerson } from "../levels";
import type { PersonLook } from "../items";
import { useSetPersonPref, type MySource } from "../queries";

export type OwnSourcePrefs = Record<string, { hidden: boolean; tone: PersonTone | null }>;

/**
 * "Calendars" (30.3): the account's own sources and the people whose
 * calendars it sees, each with a checkbox and a colour (the people's are
 * kept in the database, the account's own in the browser). Asking for a
 * share and "Find a common time" start here too.
 */
export function CalendarsPanel({
  sources,
  ownPrefs,
  onOwnChange,
  people,
  looks,
  onRequest,
  onCommonTime,
  canPlanMeetings,
}: {
  sources: MySource[];
  ownPrefs: OwnSourcePrefs;
  onOwnChange: (key: string, pref: { hidden: boolean; tone: PersonTone | null }) => void;
  people: VisiblePerson[];
  looks: ReadonlyMap<string, PersonLook>;
  onRequest: () => void;
  onCommonTime: () => void;
  canPlanMeetings: boolean;
}) {
  const t = useTranslations("calendar.sharing");
  const setPref = useSetPersonPref();
  const own = sources.length
    ? sources
    : [{ key: GRADUS_SOURCE, name: null, writes: false, privateDefault: false }];

  return (
    <div
      className="flex flex-col gap-5"
      data-testid="calendars-panel"
      data-tutorial="calendar-panel"
    >
      <section className="flex flex-col gap-1">
        <h3 className="micro-label px-1">{t("panel.mine")}</h3>
        {own.map((source) => {
          const pref = ownPrefs[source.key] ?? { hidden: false, tone: null };
          return (
            <PanelRow
              key={source.key}
              label={
                source.key === GRADUS_SOURCE
                  ? t("settings.gradus")
                  : (source.name ?? t("settings.external"))
              }
              checked={!pref.hidden}
              tone={pref.tone}
              onToggle={(checked) => onOwnChange(source.key, { ...pref, hidden: !checked })}
              onTone={
                source.key === GRADUS_SOURCE
                  ? null
                  : (tone) => onOwnChange(source.key, { ...pref, tone })
              }
            />
          );
        })}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="micro-label px-1">{t("panel.people")}</h3>
        {people.length === 0 && <p className="px-1 text-sm text-ink-muted">{t("panel.nobody")}</p>}
        {people.map((person) => {
          const look = looks.get(person.userId);
          if (!look) return null;
          return (
            <PanelRow
              key={person.userId}
              label={person.name}
              hint={t(`levels.${person.level}`)}
              avatar={
                <Avatar
                  src={person.avatarUrl}
                  name={person.name}
                  presenceOf={person.userId}
                  className="size-6"
                />
              }
              checked={!look.hidden}
              tone={look.tone}
              testId="calendars-panel-person"
              onToggle={(checked) =>
                setPref.mutate({ personId: person.userId, tone: look.tone, hidden: !checked })
              }
              onTone={(tone) =>
                setPref.mutate({ personId: person.userId, tone, hidden: look.hidden })
              }
            />
          );
        })}
      </section>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onRequest}
          data-testid="calendars-panel-request"
          data-tutorial="calendar-share-request"
        >
          <CalendarHeartIcon aria-hidden data-icon="inline-start" />
          {t("request.button")}
        </Button>
        {canPlanMeetings && (
          <Button
            type="button"
            variant="outline"
            onClick={onCommonTime}
            data-testid="calendars-panel-common"
            data-tutorial="calendar-common-time"
          >
            <CalendarSearchIcon aria-hidden data-icon="inline-start" />
            {t("common.open")}
          </Button>
        )}
      </div>
    </div>
  );
}

function PanelRow({
  label,
  hint,
  avatar,
  checked,
  tone,
  onToggle,
  onTone,
  testId,
}: {
  label: string;
  hint?: string;
  avatar?: React.ReactNode;
  checked: boolean;
  tone: PersonTone | null;
  onToggle: (checked: boolean) => void;
  onTone: ((tone: PersonTone) => void) | null;
  testId?: string;
}) {
  const t = useTranslations("calendar.sharing.panel");
  const tColors = useTranslations("scheduler.colors");
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="flex min-h-11 items-center gap-2 rounded-lg px-1 mouse:min-h-9">
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => onToggle(Boolean(next))}
          aria-label={label}
        />
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{label}</span>
          {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
        </span>
        {onTone ? (
          <button
            type="button"
            aria-label={t("color", { name: label })}
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
            className="grid size-11 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
          >
            {tone ? (
              <span aria-hidden className={cn("size-3.5 rounded-full", toneFill[tone])} />
            ) : (
              <PaletteIcon aria-hidden className="size-4 text-ink-muted" />
            )}
          </button>
        ) : (
          <span aria-hidden className="size-3.5 rounded-full bg-violet" />
        )}
      </div>
      {picking && onTone && (
        <div
          role="group"
          aria-label={t("color", { name: label })}
          className="flex flex-wrap gap-1 pb-1 pl-9"
        >
          {PERSON_TONES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tone === option}
              aria-label={tColors(option)}
              onClick={() => {
                onTone(option);
                setPicking(false);
              }}
              className={cn(
                "grid size-11 cursor-pointer place-items-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8",
                tone === option ? "border-ink" : "border-line",
              )}
            >
              <span className={cn("size-4 rounded-full", toneFill[option])} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
