"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toneFill, toneSoft } from "@/components/ui/tone";
import { useAwardXp } from "@/features/game/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { ContactPicker } from "@/features/pipeline/contact-picker";
import { useDeals } from "@/features/pipeline/queries";
import { instantToZonedParts, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { KIND_TONE } from "./calendar-logic";
import {
  draftFromEvent,
  emptyDraft,
  validateDraft,
  withAllDay,
  type EventDraft,
} from "./event-draft";
import { useCreateEvent, useUpdateEvent, eventToRow } from "./queries";
import { useSaveSharedEvent } from "./sharing/queries";
import { useSession } from "@/features/account/queries";
import { DESCRIPTION_MAX, TITLE_MAX, type CalendarErrorKey } from "./schemas";
import { EVENT_KINDS, type CalendarEvent } from "./types";

const NO_DEAL = "__none";

/** What a new event starts from: a day, or a range picked on the axis. */
export type NewEventStart = { day: IsoDate; range?: { starts_at: string; ends_at: string } };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this event, or creating one from `start`. */
  event: CalendarEvent | null;
  start: NewEventStart | null;
  /** People whose calendar the account may write into (30.3): "Into the calendar of". */
  writable?: readonly WritablePerson[];
  /** May the account add events to its own calendar here (calendar: create). */
  canCreateOwn?: boolean;
};

export type WritablePerson = { userId: string; name: string; writesTo: string | null };

/** Alt+P (Option+P) switches "Private" while the form is open. */
export function isPrivateShortcut(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  code: string;
}) {
  return event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyP";
}

const MINE = "__mine";

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  start,
  writable = [],
  canCreateOwn = true,
}: Props) {
  const t = useTranslations("calendar.form");
  const generation = useFreshOnOpen(open);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={event ? t("editTitle") : t("createTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <Fields
        key={generation}
        event={event}
        start={start}
        writable={writable}
        canCreateOwn={canCreateOwn}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function Fields({
  event,
  start,
  writable,
  canCreateOwn,
  onDone,
}: {
  event: CalendarEvent | null;
  start: NewEventStart | null;
  writable: readonly WritablePerson[];
  canCreateOwn: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("calendar");
  const { timeZone } = useFormatSettings();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const saveShared = useSaveSharedEvent();
  const { user } = useSession();
  // Someone else's event changed through a write share keeps its calendar.
  const sharedOwner = event?.shared?.canEdit ? event.shared.personId : null;
  const [owner, setOwner] = useState<string>(
    sharedOwner ?? (canCreateOwn || !writable.length ? MINE : writable[0].userId),
  );
  const intoOther = owner !== MINE;
  const target = writable.find((person) => person.userId === owner) ?? null;
  const awardXp = useAwardXp();
  const dealsQuery = useDeals();
  const [draft, setDraft] = useState<EventDraft>(() =>
    event
      ? draftFromEvent(event, timeZone)
      : emptyDraft(
          start?.day ?? instantToZonedParts(new Date(), timeZone).date,
          timeZone,
          start?.range,
        ),
  );
  const [errors, setErrors] = useState<Partial<Record<string, CalendarErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  const patch = (next: Partial<EventDraft>) => setDraft((current) => ({ ...current, ...next }));
  const err = (key: string) => (errors[key] ? t(`errors.${errors[key]}`) : undefined);
  const pending = create.isPending || update.isPending || saveShared.isPending;

  // Open deals, plus the one already linked even when it has been closed since.
  const dealItems = [
    { value: NO_DEAL, label: t("form.noDeal") },
    ...(dealsQuery.data ?? [])
      .filter((deal) => (!deal.won_at && !deal.lost_at) || deal.id === draft.dealId)
      .map((deal) => ({ value: deal.id, label: deal.title })),
  ];

  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setFailed(false);
    const result = validateDraft(draft, timeZone);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      if (intoOther || sharedOwner) {
        // Into someone's calendar through a write share: no contact or deal of theirs.
        await saveShared.mutateAsync({
          owner: sharedOwner ?? owner,
          eventId: event?.id ?? null,
          title: result.data.title,
          kind: result.data.kind,
          startsAt: result.data.starts_at,
          endsAt: result.data.ends_at,
          allDay: result.data.all_day,
          description: result.data.description,
          private: draft.private,
        });
        onDone();
        return;
      }
      if (event) {
        await update.mutateAsync({ id: event.id, patch: eventToRow(result.data) });
        onDone();
      } else {
        await create.mutateAsync(result.data);
        onDone();
        // A small reward for a new event; the server finds the one it has not paid for yet.
        awardXp.mutate({
          reason: result.data.kind === "meeting" ? "meeting_booked" : "calendar_event",
        });
      }
    } catch {
      setFailed(true);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      data-tutorial="calendar-event-form"
      onKeyDown={(keyEvent) => {
        if (!isPrivateShortcut(keyEvent)) return;
        keyEvent.preventDefault();
        if (sharedOwner && event?.actor_id !== user.id) return;
        patch({ private: !draft.private });
      }}
    >
      {!event && writable.length > 0 && (
        <FormField id="event-owner" label={t("sharing.form.into")}>
          <Select
            value={owner}
            items={[
              ...(canCreateOwn ? [{ value: MINE, label: t("sharing.form.mine") }] : []),
              ...writable.map((person) => ({ value: person.userId, label: person.name })),
            ]}
            onValueChange={(next) => next && setOwner(next)}
          >
            <SelectTrigger id="event-owner" data-testid="event-owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canCreateOwn && <SelectItem value={MINE}>{t("sharing.form.mine")}</SelectItem>}
              {writable.map((person) => (
                <SelectItem key={person.userId} value={person.userId}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target && (
            <p className="text-xs text-ink-muted">
              {target.writesTo
                ? t("sharing.form.alsoExternal", { name: target.name, calendar: target.writesTo })
                : t("sharing.form.onlyGradus", { name: target.name })}
            </p>
          )}
        </FormField>
      )}
      <FormField id="event-title" label={t("form.title")} error={err("title")}>
        <Input
          {...fieldA11y("event-title", err("title"))}
          value={draft.title}
          maxLength={TITLE_MAX + 20}
          placeholder={t("form.titlePlaceholder")}
          autoFocus={!event}
          onChange={(input) => patch({ title: input.target.value })}
        />
      </FormField>

      <div
        role="radiogroup"
        aria-label={t("form.type")}
        data-tutorial="calendar-event-kind"
        className="grid grid-cols-3 gap-2"
      >
        {EVENT_KINDS.map((kind) => {
          const selected = draft.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => patch({ kind })}
              className={cn(
                "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-10",
                selected ? toneSoft[KIND_TONE[kind]] : "border-line text-ink-soft hover:text-ink",
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-full", toneFill[KIND_TONE[kind]])} />
              {t(`kind.${kind}`)}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor="event-all-day" className="text-sm text-ink">
          {t("form.allDay")}
        </label>
        <Switch
          id="event-all-day"
          checked={draft.allDay}
          onCheckedChange={(allDay) => setDraft((current) => withAllDay(current, allDay, timeZone))}
        />
      </div>

      {draft.allDay ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="event-start" label={t("form.start")} error={err("starts_at")}>
            <DatePicker
              id="event-start"
              value={draft.startDate}
              placeholder={t("form.datePlaceholder")}
              onValueChange={(startDate) =>
                patch({
                  startDate,
                  endDate:
                    startDate && draft.endDate && draft.endDate > startDate ? draft.endDate : null,
                })
              }
            />
          </FormField>
          <FormField id="event-end" label={t("form.end")} error={err("ends_at")}>
            <DatePicker
              id="event-end"
              value={draft.endDate}
              placeholder={t("form.datePlaceholder")}
              onValueChange={(endDate) => patch({ endDate })}
            />
          </FormField>
        </div>
      ) : (
        <>
          <FormField id="event-start" label={t("form.start")} error={err("starts_at")}>
            <DateTimePicker
              id="event-start"
              value={draft.startsAt}
              timeLabel={t("form.startTime")}
              datePlaceholder={t("form.datePlaceholder")}
              onValueChange={(startsAt) => {
                // The length stays when the start moves.
                const shift =
                  startsAt && draft.startsAt && draft.endsAt
                    ? new Date(startsAt).getTime() - new Date(draft.startsAt).getTime()
                    : 0;
                patch({
                  startsAt,
                  endsAt: draft.endsAt
                    ? new Date(new Date(draft.endsAt).getTime() + shift).toISOString()
                    : null,
                });
              }}
            />
          </FormField>
          <FormField id="event-end" label={t("form.end")} error={err("ends_at")}>
            <DateTimePicker
              id="event-end"
              value={draft.endsAt}
              timeLabel={t("form.endTime")}
              datePlaceholder={t("form.datePlaceholder")}
              invalid={!!err("ends_at")}
              onValueChange={(endsAt) => patch({ endsAt })}
            />
          </FormField>
        </>
      )}

      {!intoOther && !sharedOwner && (
        <>
          <FormField id="event-contact" label={t("form.contact")}>
            <ContactPicker
              id="event-contact"
              value={draft.contact}
              onChange={(contact) => patch({ contact })}
            />
          </FormField>

          <FormField id="event-deal" label={t("form.deal")}>
            <Select
              value={draft.dealId ?? NO_DEAL}
              items={dealItems}
              onValueChange={(next) => patch({ dealId: next && next !== NO_DEAL ? next : null })}
            >
              <SelectTrigger id="event-deal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dealItems.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </>
      )}

      <FormField id="event-description" label={t("form.description")} error={err("description")}>
        <Textarea
          {...fieldA11y("event-description", err("description"))}
          value={draft.description}
          maxLength={DESCRIPTION_MAX + 100}
          onChange={(input) => patch({ description: input.target.value })}
        />
      </FormField>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <label htmlFor="event-private" className="text-sm text-ink">
            {t("sharing.form.private")}
          </label>
          <span className="text-xs text-ink-muted">{t("sharing.form.privateHint")}</span>
        </div>
        <Switch
          id="event-private"
          checked={draft.private}
          // Only the person of the calendar (or who made it) decides; the database keeps it otherwise.
          disabled={Boolean(sharedOwner) && event?.actor_id !== user.id}
          onCheckedChange={(checked) => patch({ private: checked })}
          aria-keyshortcuts="Alt+P"
          data-testid="event-private"
          data-tutorial="calendar-event-private"
        />
      </div>

      {failed && <FormAlert>{t("form.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {event ? t("form.save") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
