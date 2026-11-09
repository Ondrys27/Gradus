"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowDownIcon, ArrowUpIcon, LockIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TonePicker } from "@/components/ui/tone-picker";
import { useCan } from "@/features/account/workspace-queries";
import { useStages } from "@/features/pipeline/queries";
import { formatDayMonth, formatIsoTime, formatWeekdayShort, isoDateToLocal } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_TABS, type EventTypeTab } from "../analytics";
import {
  draftIssues,
  isBuiltinQuestion,
  isRemovableQuestion,
  moveItem,
  newQuestion,
  type DraftIssue,
  type EventTypeDraft,
} from "../event-type-form";
import { isValidSlug, slugify, SLUG_MAX } from "../handle";
import {
  useAvailability,
  useCreateEventType,
  usePreviewSlots,
  useUpdateEventType,
  writeProblem,
} from "../queries";
import {
  BUFFER_MAX,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_PRESETS,
  HORIZON_MAX_DAYS,
  LOCATION_KINDS,
  MAX_QUESTIONS,
  MAX_REMINDERS,
  NOTICE_MAX_HOURS,
  PER_DAY_MAX,
  QUESTION_TYPES,
  REMINDER_PRESETS,
  SLOT_STEPS,
  TYPE_TONES,
  type EventType,
  type Question,
  type QuestionType,
  type SchedulerProfile,
} from "../types";
import { WeekForm } from "./availability-tab";
import {
  CopyLinkButton,
  LOCATION_ICONS,
  PlanLimitNotice,
  useDurationText,
  useOffsetText,
} from "./common";

const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 45, 60, 90, 120];
const NONE = "none";

type Props = {
  /** The type being edited; null with `draft` for a new one. */
  type: EventType | null;
  draft: EventTypeDraft | null;
  profile: SchedulerProfile;
  otherSlugs: string[];
  /** Whether a new type starts active (the plan allows another one). */
  startActive: boolean;
  limit: number | null;
  editable: boolean;
  open: boolean;
  onClose: () => void;
  /** A new type was saved: the editor goes on with it. */
  onCreated: (type: EventType) => void;
  position: number;
  /** Deletes the type being edited (asks first); absent for a new one. */
  onDelete?: () => void;
  deleting?: boolean;
};

/**
 * The editor of a meeting type: a large window (the whole screen on a phone)
 * with the tabs Basics · Availability · Questions · Reminders · Confirmation ·
 * Preview. One Save writes the whole type; its own weekly hours have their
 * own Save inside the Availability tab.
 */
export function EventTypeEditor(props: Props) {
  const t = useTranslations("scheduler.editor");
  const isPhone = useIsPhone();
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed z-overlay flex flex-col overflow-hidden bg-surface shadow-popover outline-none",
            "transition-[opacity,scale,translate] duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0",
            isPhone
              ? "inset-0 pt-[env(safe-area-inset-top)] data-ending-style:translate-y-4 data-starting-style:translate-y-4"
              : "top-1/2 left-1/2 h-[min(90dvh,860px)] w-[min(100vw-32px,880px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line-strong data-ending-style:scale-[0.98] data-starting-style:scale-[0.98]",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
            <Dialog.Title className="micro-label">
              {props.type ? t("editTitle") : t("newTitle")}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {props.open && (props.type || props.draft) && (
            <EditorBody key={props.type?.id ?? "new"} {...props} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorBody({
  type,
  draft: initial,
  profile,
  otherSlugs,
  startActive,
  limit,
  editable,
  onClose,
  onCreated,
  position,
  onDelete,
  deleting,
}: Props) {
  const t = useTranslations("scheduler.editor");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<EventTypeTab>("basics");
  const [draft, setDraft] = useState<EventTypeDraft>(() => initial ?? draftFromType(type!));
  // A new type's slug follows its name until the person types one.
  const [slugTouched, setSlugTouched] = useState(Boolean(type));
  const [showIssues, setShowIssues] = useState(false);
  const create = useCreateEventType(profile.id);
  const update = useUpdateEventType();
  const issues = draftIssues(draft, otherSlugs);
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const problem = error ? writeProblem(error) : null;

  const set = <K extends keyof EventTypeDraft>(key: K, value: EventTypeDraft[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !slugTouched)
        next.slug = slugify(String(value), SLUG_MAX) || current.slug;
      return next;
    });

  function save() {
    setShowIssues(true);
    if (issues.length) {
      const first = issues[0];
      setTab(tabOfIssue(first));
      return;
    }
    if (type) {
      update.mutate({ id: type.id, draft, tab });
    } else {
      create.mutate(
        { draft, position, active: startActive, preset: false },
        { onSuccess: (created) => onCreated(created) },
      );
    }
  }

  const panel: Record<EventTypeTab, ReactNode> = {
    basics: (
      <BasicsTab
        draft={draft}
        set={set}
        profile={profile}
        issues={showIssues ? issues : []}
        onSlug={() => setSlugTouched(true)}
      />
    ),
    availability: (
      <AvailabilityTabPanel
        draft={draft}
        set={set}
        type={type}
        profile={profile}
        editable={editable}
        issues={showIssues ? issues : []}
      />
    ),
    questions: <QuestionsTab draft={draft} set={set} issues={showIssues ? issues : []} />,
    reminders: <RemindersTab draft={draft} set={set} issues={showIssues ? issues : []} />,
    confirmation: <ConfirmationTab draft={draft} set={set} />,
    preview: <PreviewTab type={type} draft={draft} profile={profile} />,
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 sm:px-5"
      >
        {EVENT_TYPE_TABS.map((key) => {
          const flagged = showIssues && issues.some((issue) => tabOfIssue(issue) === key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`type-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`type-panel-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "relative min-h-11 shrink-0 cursor-pointer px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                tab === key
                  ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet after:content-['']"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {t(`tabs.${key}`)}
              {flagged && (
                <span
                  aria-hidden
                  className="ml-1 inline-block size-1.5 rounded-full bg-pink align-middle"
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`type-panel-${tab}`}
        aria-labelledby={`type-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <fieldset disabled={!editable} className="flex flex-col gap-5">
          {panel[tab]}
        </fieldset>
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {problem === "planLimit" && <PlanLimitNotice limit={limit} />}
        {problem && problem !== "planLimit" && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
        {!type && !startActive && <p className="text-xs text-ink-muted">{t("startsInactive")}</p>}
        {(create.isSuccess || update.isSuccess) && !pending && !error && (
          <p role="status" className="text-sm text-green">
            {t("saved")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {type && onDelete && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("delete")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
          {editable && (
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? t("saving") : type ? t("save") : t("create")}
            </Button>
          )}
        </div>
      </div>
      {type && onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t("deleteTitle", { name: type.name })}
          description={t("deleteText")}
          confirmLabel={t("delete")}
          cancelLabel={t("cancel")}
          closeLabel={t("close")}
          pending={deleting}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}

function draftFromType(type: EventType): EventTypeDraft {
  return {
    name: type.name,
    slug: type.slug,
    description: type.description,
    duration_min: type.duration_min,
    location_kind: type.location_kind,
    location_text: type.location_text,
    color: type.color,
    requires_approval: type.requires_approval,
    buffer_before_min: type.buffer_before_min,
    buffer_after_min: type.buffer_after_min,
    min_notice_hours: type.min_notice_hours,
    max_days_ahead: type.max_days_ahead,
    max_per_day: type.max_per_day,
    slot_step_min: type.slot_step_min,
    custom_availability: type.custom_availability,
    questions: type.questions.map((question) => ({
      ...question,
      options: question.options && [...question.options],
    })),
    reminders: type.reminders.map((reminder) => ({ ...reminder })),
    deal_stage_id: type.deal_stage_id,
    confirmation_note: type.confirmation_note,
  };
}

function tabOfIssue(issue: DraftIssue): EventTypeTab {
  switch (issue.field) {
    case "questions":
      return "questions";
    case "reminders":
      return "reminders";
    case "buffers":
    case "notice":
    case "horizon":
    case "perDay":
    case "step":
      return "availability";
    case "confirmation_note":
      return "confirmation";
    default:
      return "basics";
  }
}

type SetDraft = <K extends keyof EventTypeDraft>(key: K, value: EventTypeDraft[K]) => void;

function issueText(
  t: ReturnType<typeof useTranslations>,
  issues: DraftIssue[],
  field: DraftIssue["field"],
) {
  const issue = issues.find((item) => item.field === field);
  return issue ? t(`issues.${field}.${issue.code}`) : undefined;
}

/** A whole number from a field, or null when it is empty. */
function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

function BasicsTab({
  draft,
  set,
  profile,
  issues,
  onSlug,
}: {
  draft: EventTypeDraft;
  set: SetDraft;
  profile: SchedulerProfile;
  issues: DraftIssue[];
  onSlug: () => void;
}) {
  const t = useTranslations("scheduler.editor");
  const tTones = useTranslations("scheduler.colors");
  const durationText = useDurationText();
  const custom = !(DURATION_PRESETS as readonly number[]).includes(draft.duration_min);
  const nameError = issueText(t, issues, "name");
  const slugError = issueText(t, issues, "slug");
  const placeError = issueText(t, issues, "location_text");
  const durationError = issueText(t, issues, "duration_min");
  return (
    <>
      <FormField id="type-name" label={t("name")} error={nameError}>
        <Input
          {...fieldA11y("type-name", nameError)}
          value={draft.name}
          maxLength={80}
          onChange={(event) => set("name", event.target.value)}
        />
      </FormField>
      <FormField
        id="type-slug"
        label={t("slug")}
        error={slugError}
        hint={t("slugHint", { path: `/s/${profile.handle}/${draft.slug || "…"}` })}
      >
        <Input
          {...fieldA11y("type-slug", slugError, true)}
          value={draft.slug}
          maxLength={SLUG_MAX}
          onChange={(event) => {
            onSlug();
            set("slug", slugify(event.target.value, SLUG_MAX) || event.target.value.toLowerCase());
          }}
          aria-invalid={draft.slug && !isValidSlug(draft.slug) ? true : undefined}
        />
      </FormField>
      <FormField
        id="type-description"
        label={t("description")}
        error={issueText(t, issues, "description")}
      >
        <Textarea
          id="type-description"
          rows={3}
          maxLength={2000}
          value={draft.description ?? ""}
          placeholder={t("descriptionPlaceholder")}
          onChange={(event) => set("description", event.target.value)}
        />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("duration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_PRESETS.map((minutes) => (
            <Chip
              key={minutes}
              pressed={draft.duration_min === minutes}
              onClick={() => set("duration_min", minutes)}
            >
              {durationText(minutes)}
            </Chip>
          ))}
          <Chip pressed={custom} onClick={() => !custom && set("duration_min", 25)}>
            {t("durationCustom")}
          </Chip>
        </div>
        {custom && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={DURATION_MIN}
              max={DURATION_MAX}
              aria-label={t("durationMinutes")}
              value={draft.duration_min}
              onChange={(event) => set("duration_min", numberOrNull(event.target.value) ?? 0)}
              className="w-28"
            />
            <span className="text-sm text-ink-muted">{t("minutesUnit")}</span>
          </div>
        )}
        {durationError && <p className="text-xs text-pink">{durationError}</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("location")}</legend>
        <div className="flex flex-wrap gap-2">
          {LOCATION_KINDS.map((kind) => {
            const Icon = LOCATION_ICONS[kind];
            return (
              <Chip
                key={kind}
                pressed={draft.location_kind === kind}
                onClick={() => set("location_kind", kind)}
              >
                <Icon aria-hidden className="size-4" />
                {t(`locations.${kind}`)}
              </Chip>
            );
          })}
        </div>
        {draft.location_kind === "video" ? (
          <p className="text-xs text-ink-muted">
            {profile.video_link ? t("videoUses", { link: profile.video_link }) : t("videoMissing")}
          </p>
        ) : (
          <FormField
            id="type-place"
            label={t(`placeLabel.${draft.location_kind}`)}
            error={placeError}
            hint={t(`placeHint.${draft.location_kind}`)}
          >
            <Input
              {...fieldA11y("type-place", placeError, true)}
              value={draft.location_text ?? ""}
              maxLength={300}
              onChange={(event) => set("location_text", event.target.value)}
            />
          </FormField>
        )}
      </fieldset>
      <TonePicker
        tones={TYPE_TONES}
        value={draft.color}
        onChange={(tone) => set("color", tone)}
        label={t("color")}
        labelOf={(tone) => tTones(tone)}
      />
    </>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 mouse:min-h-9",
        pressed
          ? "border-violet bg-violet/12 font-medium text-ink"
          : "border-line text-ink-soft hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function AvailabilityTabPanel({
  draft,
  set,
  type,
  profile,
  editable,
  issues,
}: {
  draft: EventTypeDraft;
  set: SetDraft;
  type: EventType | null;
  profile: SchedulerProfile;
  editable: boolean;
  issues: DraftIssue[];
}) {
  const t = useTranslations("scheduler.editor");
  const durationText = useDurationText();
  const availability = useAvailability(profile.id);
  const ownRules = useMemo(
    () => (availability.data?.rules ?? []).filter((rule) => type && rule.event_type_id === type.id),
    [availability.data, type],
  );
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="type-custom-hours" className="text-sm font-medium text-ink">
            {t("customHours")}
          </label>
          <p className="text-[13px] text-ink-muted">{t("customHoursHint")}</p>
        </div>
        <Switch
          id="type-custom-hours"
          checked={draft.custom_availability}
          onCheckedChange={(checked) => set("custom_availability", checked)}
        />
      </div>
      {draft.custom_availability &&
        (type ? (
          availability.isPending ? (
            <Skeleton className="h-48 rounded-2xl" />
          ) : (
            <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
              <WeekForm
                profileId={profile.id}
                eventTypeId={type.id}
                rules={ownRules}
                editable={editable}
              />
              {!type.custom_availability && (
                <p className="text-xs text-ink-muted">{t("customHoursSaveHint")}</p>
              )}
            </div>
          )
        ) : (
          <p className="text-sm text-ink-muted">{t("customHoursAfterCreate")}</p>
        ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="type-buffer-before"
          label={t("bufferBefore")}
          error={issueText(t, issues, "buffers")}
        >
          <NumberSelect
            id="type-buffer-before"
            value={draft.buffer_before_min}
            options={BUFFER_OPTIONS.filter((value) => value <= BUFFER_MAX)}
            label={(value) => (value ? durationText(value) : t("none"))}
            onChange={(value) => set("buffer_before_min", value)}
          />
        </FormField>
        <FormField id="type-buffer-after" label={t("bufferAfter")}>
          <NumberSelect
            id="type-buffer-after"
            value={draft.buffer_after_min}
            options={BUFFER_OPTIONS.filter((value) => value <= BUFFER_MAX)}
            label={(value) => (value ? durationText(value) : t("none"))}
            onChange={(value) => set("buffer_after_min", value)}
          />
        </FormField>
        <FormField
          id="type-notice"
          label={t("notice")}
          hint={t("noticeHint")}
          error={issueText(t, issues, "notice")}
        >
          <div className="flex items-center gap-2">
            <Input
              id="type-notice"
              type="number"
              inputMode="numeric"
              min={0}
              max={NOTICE_MAX_HOURS}
              value={draft.min_notice_hours}
              onChange={(event) => set("min_notice_hours", numberOrNull(event.target.value) ?? 0)}
              className="w-28"
            />
            <span className="text-sm text-ink-muted">{t("hoursUnit")}</span>
          </div>
        </FormField>
        <FormField
          id="type-horizon"
          label={t("horizon")}
          hint={t("horizonHint", { max: HORIZON_MAX_DAYS })}
          error={issueText(t, issues, "horizon")}
        >
          <div className="flex items-center gap-2">
            <Input
              id="type-horizon"
              type="number"
              inputMode="numeric"
              min={1}
              max={HORIZON_MAX_DAYS}
              value={draft.max_days_ahead}
              onChange={(event) => set("max_days_ahead", numberOrNull(event.target.value) ?? 0)}
              className="w-28"
            />
            <span className="text-sm text-ink-muted">{t("daysUnit")}</span>
          </div>
        </FormField>
        <FormField
          id="type-per-day"
          label={t("perDay")}
          hint={t("perDayHint")}
          error={issueText(t, issues, "perDay")}
        >
          <Input
            id="type-per-day"
            type="number"
            inputMode="numeric"
            min={1}
            max={PER_DAY_MAX}
            placeholder={t("noLimit")}
            value={draft.max_per_day ?? ""}
            onChange={(event) => set("max_per_day", numberOrNull(event.target.value))}
            className="w-28"
          />
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-soft">{t("step")}</legend>
          <div className="flex flex-wrap gap-2">
            {SLOT_STEPS.map((step) => (
              <Chip
                key={step}
                pressed={draft.slot_step_min === step}
                onClick={() => set("slot_step_min", step)}
              >
                {durationText(step)}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-ink-muted">{t("stepHint")}</p>
        </fieldset>
      </div>
    </>
  );
}

function NumberSelect({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: number;
  options: number[];
  label: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select
      value={String(value)}
      items={all.map((option) => ({ value: String(option), label: label(option) }))}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function QuestionsTab({
  draft,
  set,
  issues,
}: {
  draft: EventTypeDraft;
  set: SetDraft;
  issues: DraftIssue[];
}) {
  const t = useTranslations("scheduler.editor");
  const tQ = useTranslations("scheduler.questions");
  const list = draft.questions;
  const update = (index: number, patch: Partial<Question>) =>
    set(
      "questions",
      list.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    );
  return (
    <>
      <p className="text-[13px] text-ink-muted">{tQ("hint")}</p>
      <ol className="flex flex-col gap-3">
        {list.map((question, index) => {
          const builtin = isBuiltinQuestion(question);
          const issue = issues.find((item) => item.field === "questions" && item.index === index);
          return (
            <li
              key={question.key}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {builtin
                    ? tQ(`builtin.${question.key}`)
                    : question.label?.trim() || tQ("untitled")}
                </span>
                {!isRemovableQuestion(question) && (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                    <LockIcon aria-hidden className="size-3" />
                    {tQ("always")}
                  </span>
                )}
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tQ("moveUp")}
                  disabled={index === 0}
                  onClick={() => set("questions", moveItem(list, index, index - 1))}
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tQ("moveDown")}
                  disabled={index === list.length - 1}
                  onClick={() => set("questions", moveItem(list, index, index + 1))}
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                {isRemovableQuestion(question) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tQ("remove")}
                    onClick={() =>
                      set(
                        "questions",
                        list.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2Icon aria-hidden className="text-destructive" />
                  </Button>
                )}
              </div>
              {!builtin && (
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                  <Input
                    aria-label={tQ("label")}
                    placeholder={tQ("labelPlaceholder")}
                    value={question.label ?? ""}
                    maxLength={200}
                    aria-invalid={issue?.code === "label" ? true : undefined}
                    onChange={(event) => update(index, { label: event.target.value })}
                  />
                  <Select
                    value={question.type}
                    items={QUESTION_TYPES.filter(
                      (type) => type !== "email" && type !== "phone",
                    ).map((type) => ({
                      value: type,
                      label: tQ(`types.${type}`),
                    }))}
                    onValueChange={(next) => {
                      const type = next as QuestionType;
                      update(index, {
                        type,
                        options: type === "select" ? (question.options ?? [""]) : undefined,
                      });
                    }}
                  >
                    <SelectTrigger aria-label={tQ("type")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUESTION_TYPES.filter((type) => type !== "email" && type !== "phone").map(
                        (type) => (
                          <SelectItem key={type} value={type}>
                            {tQ(`types.${type}`)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {question.type === "select" && (
                <Textarea
                  aria-label={tQ("options")}
                  placeholder={tQ("optionsPlaceholder")}
                  rows={3}
                  value={(question.options ?? []).join("\n")}
                  aria-invalid={issue?.code === "options" ? true : undefined}
                  onChange={(event) => update(index, { options: event.target.value.split("\n") })}
                />
              )}
              {issue && <p className="text-xs text-pink">{t(`issues.questions.${issue.code}`)}</p>}
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink-soft">
                <Switch
                  checked={question.required}
                  disabled={!isRemovableQuestion(question)}
                  onCheckedChange={(checked) => update(index, { required: checked })}
                />
                {tQ("required")}
              </label>
            </li>
          );
        })}
      </ol>
      {issues.some((issue) => issue.field === "questions" && issue.index === undefined) && (
        <FormAlert>
          {t(
            `issues.questions.${issues.find((issue) => issue.field === "questions" && issue.index === undefined)!.code}`,
          )}
        </FormAlert>
      )}
      {list.length < MAX_QUESTIONS && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => set("questions", [...list, newQuestion(list)])}
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          {tQ("add")}
        </Button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

function RemindersTab({
  draft,
  set,
  issues,
}: {
  draft: EventTypeDraft;
  set: SetDraft;
  issues: DraftIssue[];
}) {
  const t = useTranslations("scheduler.editor");
  const tR = useTranslations("scheduler.reminders");
  const offsetText = useOffsetText();
  const list = draft.reminders;
  const used = new Set(list.map((reminder) => reminder.offset_minutes));
  const next = REMINDER_PRESETS.find((minutes) => !used.has(minutes));
  return (
    <>
      <p className="text-[13px] text-ink-muted">{tR("hint")}</p>
      {list.length === 0 && <p className="text-sm text-ink-muted">{tR("none")}</p>}
      <ul className="flex flex-col gap-2">
        {list.map((reminder, index) => {
          const issue = issues.find((item) => item.field === "reminders" && item.index === index);
          const options = [...new Set([...REMINDER_PRESETS, reminder.offset_minutes])]
            .filter((minutes) => minutes === reminder.offset_minutes || !used.has(minutes))
            .sort((a, b) => a - b);
          return (
            <li key={`${reminder.offset_minutes}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-56">
                  <NumberSelect
                    id={`reminder-${index}`}
                    value={reminder.offset_minutes}
                    options={options}
                    label={offsetText}
                    onChange={(value) =>
                      set(
                        "reminders",
                        list.map((item, i) =>
                          i === index ? { ...item, offset_minutes: value } : item,
                        ),
                      )
                    }
                  />
                </div>
                <span className="text-sm text-ink-muted">{tR("byEmail")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tR("remove")}
                  onClick={() =>
                    set(
                      "reminders",
                      list.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2Icon aria-hidden className="text-destructive" />
                </Button>
              </div>
              {issue && <p className="text-xs text-pink">{t(`issues.reminders.${issue.code}`)}</p>}
            </li>
          );
        })}
      </ul>
      {list.length < MAX_REMINDERS && next !== undefined && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => set("reminders", [...list, { offset_minutes: next, channel: "email" }])}
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          {tR("add")}
        </Button>
      )}
      <p className="text-xs text-ink-muted">{tR("max", { count: MAX_REMINDERS })}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

function ConfirmationTab({ draft, set }: { draft: EventTypeDraft; set: SetDraft }) {
  const t = useTranslations("scheduler.editor");
  const canPipeline = useCan("pipeline", "view");
  const stages = useStages();
  const open = (stages.data ?? []).filter((stage) => !stage.is_lost);
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <label htmlFor="type-approval" className="text-sm font-medium text-ink">
            {t("approval")}
          </label>
          <p className="text-[13px] text-ink-muted">{t("approvalHint")}</p>
        </div>
        <Switch
          id="type-approval"
          checked={draft.requires_approval}
          onCheckedChange={(checked) => set("requires_approval", checked)}
        />
      </div>
      <FormField id="type-note" label={t("confirmationNote")} hint={t("confirmationNoteHint")}>
        <Textarea
          id="type-note"
          rows={4}
          maxLength={1000}
          value={draft.confirmation_note ?? ""}
          onChange={(event) => set("confirmation_note", event.target.value)}
        />
      </FormField>
      {canPipeline && (
        <FormField id="type-stage" label={t("dealStage")} hint={t("dealStageHint")}>
          <Select
            value={draft.deal_stage_id ?? NONE}
            items={[
              { value: NONE, label: t("noDeal") },
              ...open.map((stage) => ({ value: stage.id, label: stage.name })),
            ]}
            onValueChange={(next) => set("deal_stage_id", next === NONE ? null : (next as string))}
          >
            <SelectTrigger id="type-stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("noDeal")}</SelectItem>
              {open.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const PREVIEW_DAYS = 7;

function PreviewTab({
  type,
  draft,
  profile,
}: {
  type: EventType | null;
  draft: EventTypeDraft;
  profile: SchedulerProfile;
}) {
  const t = useTranslations("scheduler.editor");
  const locale = useLocale();
  const settings = useFormatSettings();
  const durationText = useDurationText();
  const guestZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || settings.timeZone,
    [settings.timeZone],
  );
  const preview = usePreviewSlots(type?.id, guestZone);
  const Icon = LOCATION_ICONS[draft.location_kind];
  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas-deep/40 p-5">
        <p className="micro-label">{profile.display_name ?? profile.handle}</p>
        <h3 className="text-xl font-semibold text-ink">{draft.name || t("untitled")}</h3>
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          <span>{durationText(draft.duration_min)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Icon aria-hidden className="size-4" />
            {t(`locations.${draft.location_kind}`)}
          </span>
        </p>
        {draft.description && (
          <p className="text-sm whitespace-pre-line text-ink-soft">{draft.description}</p>
        )}
        {type && <CopyLinkButton handle={profile.handle} slug={type.slug} from="editor" />}
      </div>
      {!type ? (
        <p className="text-sm text-ink-muted">{t("previewAfterCreate")}</p>
      ) : preview.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : preview.isError ? (
        <FormAlert>{t("previewFailed")}</FormAlert>
      ) : preview.data.days.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("previewEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-ink-muted">
            {t("previewHint", { zone: preview.data.timeZone })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {preview.data.days.slice(0, PREVIEW_DAYS).map((day) => {
              const date = isoDateToLocal(day.day);
              return (
                <div
                  key={day.day}
                  className="flex flex-col gap-2 rounded-2xl border border-line p-3"
                >
                  <p className="text-sm font-semibold text-ink capitalize">
                    {formatWeekdayShort(date, locale)} {formatDayMonth(day.day, settings)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {day.slots.map((slot) => (
                      <span
                        key={slot.start}
                        className="rounded-lg border border-teal/30 bg-teal/10 px-2 py-1 text-xs text-teal tabular-nums"
                      >
                        {formatIsoTime(slot.time, settings)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {!type.active && <p className="text-xs text-ink-muted">{t("previewInactive")}</p>}
        </div>
      )}
    </>
  );
}
