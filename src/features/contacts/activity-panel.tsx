"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowRightLeftIcon,
  CalendarCheckIcon,
  HistoryIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  StickyNoteIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useActivities, useAddActivity, useDeleteActivity } from "./queries";
import { ACTIVITY_MAX, activitySchema, fieldErrors, type ContactErrorKey } from "./schemas";
import { MANUAL_ACTIVITY_TYPES, type ActivityType } from "./types";

const ICONS: Record<ActivityType, LucideIcon> = {
  call: PhoneIcon,
  email: MailIcon,
  meeting: CalendarCheckIcon,
  sms: MessageSquareIcon,
  note: StickyNoteIcon,
  move: ArrowRightLeftIcon,
};

export function ActivityPanel({ contactId }: { contactId: string }) {
  const t = useTranslations("contacts.activity");
  const settings = useFormatSettings();
  const activities = useActivities(contactId);
  const remove = useDeleteActivity(contactId);
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="contact-activity" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="contact-activity" className="micro-label">
          {t("title")}
        </h2>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            {t("add")}
          </Button>
        )}
      </div>

      {adding && <ActivityForm contactId={contactId} onDone={() => setAdding(false)} />}

      {activities.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : activities.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : activities.data.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          <HistoryIcon aria-hidden className="size-4 shrink-0" />
          {t("empty")}
        </p>
      ) : (
        <ol className="flex flex-col">
          {activities.data.map((activity) => {
            const Icon = ICONS[activity.type];
            return (
              <li
                key={activity.id}
                className="group flex gap-3 border-b border-line/60 py-3 last:border-b-0"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-hover text-ink-soft">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-ink">{t(`types.${activity.type}`)}</span>
                    <time dateTime={activity.occurred_at} className="text-xs text-ink-muted">
                      {formatDateTime(new Date(activity.occurred_at), settings)}
                    </time>
                  </p>
                  {activity.content && (
                    <p className="text-sm whitespace-pre-line text-ink-soft">{activity.content}</p>
                  )}
                </div>
                {activity.type !== "move" && (
                  <button
                    type="button"
                    aria-label={t("delete")}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(activity.id)}
                    className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted outline-none hover:text-pink focus-visible:ring-3 focus-visible:ring-pink/40 mouse:size-8"
                  >
                    <Trash2Icon aria-hidden className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {remove.isError && <FormAlert>{t("deleteFailed")}</FormAlert>}
    </section>
  );
}

function ActivityForm({ contactId, onDone }: { contactId: string; onDone: () => void }) {
  const t = useTranslations("contacts");
  const add = useAddActivity(contactId);
  const [type, setType] = useState<(typeof MANUAL_ACTIVITY_TYPES)[number]>("call");
  const [content, setContent] = useState("");
  const [occurredAt, setOccurredAt] = useState<string | null>(() => new Date().toISOString());
  const [errors, setErrors] = useState<Partial<Record<string, ContactErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = activitySchema.safeParse({ type, content, occurred_at: occurredAt ?? "" });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await add.mutateAsync(parsed.data);
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const whenError = errors.occurred_at && t(`errors.${errors.occurred_at}`);

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface-hover/40 p-4"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("activity.type")}</legend>
        <div className="flex flex-wrap gap-2">
          {MANUAL_ACTIVITY_TYPES.map((value) => {
            const Icon = ICONS[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(value)}
                className={cn(
                  "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
                  type === value
                    ? "border-violet/60 bg-violet/15 text-ink"
                    : "border-line text-ink-soft hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {t(`activity.types.${value}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <FormField id="activity-when" label={t("activity.when")} error={whenError}>
        <DateTimePicker
          id="activity-when"
          value={occurredAt}
          onValueChange={setOccurredAt}
          timeLabel={t("activity.time")}
          invalid={Boolean(whenError)}
          describedBy={whenError ? "activity-when-message" : undefined}
        />
      </FormField>
      <FormField
        id="activity-content"
        label={t("activity.content")}
        error={errors.content && t(`errors.${errors.content}`)}
      >
        <Textarea
          id="activity-content"
          value={content}
          maxLength={ACTIVITY_MAX}
          placeholder={t("activity.contentPlaceholder")}
          onChange={(event) => setContent(event.target.value)}
        />
      </FormField>
      {failed && <FormAlert>{t("activity.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("activity.cancel")}
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {t("activity.save")}
        </Button>
      </div>
    </form>
  );
}
