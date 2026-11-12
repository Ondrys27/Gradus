"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon, BriefcaseBusinessIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toneFill } from "@/components/ui/tone";
import { useAwardXp } from "@/features/game/queries";
import { offersDeal } from "@/features/pipeline/contact-deals";
import { NewDealFromContactForm } from "@/features/pipeline/new-deal-from-contact";
import type { DealContact } from "@/features/pipeline/types";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { instantToZonedParts, todayIsoDate, zonedWallClockToInstant } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { byPosition, fieldOptions } from "./field-logic";
import {
  answerErrors,
  initialAnswers,
  shownFields,
  type AnswerError,
  type Answers,
} from "./move-form";
import { useMoveContact } from "./queries";
import { useFields } from "./table-queries";
import { tableTone, type ContactField, type ContactTable } from "./types";

export type MoveResult = {
  table: ContactTable;
  meetingBooked: boolean;
  /** The deal made right after the move (Cold Calling offers one), if any. */
  deal?: { id: string; title: string };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  currentTableId: string | null;
  tables: ContactTable[];
  onMoved: (result: MoveResult) => void;
  /** Skip the table picker and open straight to this table's questions (by system_key). */
  targetSystemKey?: string;
  /** Answers to prefill by the question's system_key, e.g. the e-mail just sent. */
  prefillBySystemKey?: Record<string, string>;
  /**
   * The contact, when a deal may be made for it right after a move into a
   * table that offers one (Cold Calling). Absent: no offer.
   */
  dealContact?: DealContact;
};

export function MoveContactDialog({
  open,
  onOpenChange,
  contactId,
  currentTableId,
  tables,
  onMoved,
  targetSystemKey,
  prefillBySystemKey,
  dealContact,
}: Props) {
  const t = useTranslations("contacts.move");
  const generation = useFreshOnOpen(open);
  // A move that offers a deal is reported only when the dialog closes: in Cold
  // Calling the report opens the next contact, which would close this dialog.
  const pending = useRef<MoveResult | null>(null);
  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (next || !pending.current) return;
    const result = pending.current;
    pending.current = null;
    onMoved(result);
  }
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={changeOpen}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <MoveSteps
        key={generation}
        contactId={contactId}
        from={tables.find((table) => table.id === currentTableId) ?? null}
        // Clients fill themselves from won deals; nobody moves there by hand.
        targets={byPosition(tables).filter(
          (table) => table.id !== currentTableId && table.system_key !== "clients",
        )}
        targetSystemKey={targetSystemKey}
        prefillBySystemKey={prefillBySystemKey}
        dealContact={dealContact}
        onDone={() => changeOpen(false)}
        onMoved={onMoved}
        onHold={(result) => {
          pending.current = result;
        }}
      />
    </ResponsiveDialog>
  );
}

function MoveSteps({
  contactId,
  from,
  targets,
  targetSystemKey,
  prefillBySystemKey,
  dealContact,
  onDone,
  onMoved,
  onHold,
}: {
  contactId: string;
  from: ContactTable | null;
  targets: ContactTable[];
  targetSystemKey?: string;
  prefillBySystemKey?: Record<string, string>;
  dealContact?: DealContact;
  onDone: () => void;
  onMoved: (result: MoveResult) => void;
  /** Keeps the result until the dialog closes (see MoveContactDialog). */
  onHold: (result: MoveResult) => void;
}) {
  const t = useTranslations("contacts.move");
  const fieldsQuery = useFields();
  const [target, setTarget] = useState<ContactTable | null>(
    () => targets.find((table) => table.system_key === targetSystemKey) ?? null,
  );
  const [offer, setOffer] = useState<MoveResult | null>(null);

  if (offer && dealContact) {
    return (
      <DealOffer
        contact={dealContact}
        result={offer}
        onDone={onDone}
        onCreated={(deal) => {
          onHold({ ...offer, deal: { id: deal.id, title: deal.title } });
          onDone();
        }}
      />
    );
  }

  if (target && fieldsQuery.data) {
    const fields = fieldsQuery.data.filter((field) => field.table_id === target.id);
    return (
      <AnswerForm
        key={target.id}
        contactId={contactId}
        from={from}
        table={target}
        fields={fields}
        prefillBySystemKey={prefillBySystemKey}
        onBack={() => setTarget(null)}
        onDone={onDone}
        onMoved={(result) => {
          if (dealContact && offersDeal(result.table.system_key)) {
            // The dialog stays open with the offer; the move is reported when it closes.
            onHold(result);
            setOffer(result);
            return;
          }
          onDone();
          onMoved(result);
        }}
      />
    );
  }

  if (target && fieldsQuery.isPending) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">{t("pickTable")}</p>
      <ul className="flex flex-col gap-2">
        {targets.map((table) => (
          <li key={table.id}>
            <button
              type="button"
              disabled={fieldsQuery.isError}
              onClick={() => setTarget(table)}
              className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-line px-4 text-left text-sm font-medium text-ink outline-none hover:border-line-strong hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", toneFill[tableTone(table.color)])}
              />
              <span className="min-w-0 flex-1 truncate">{table.name}</span>
              <ChevronRightIcon aria-hidden className="size-4 text-ink-muted" />
            </button>
          </li>
        ))}
      </ul>
      {fieldsQuery.isError && <FormAlert>{t("loadFailed")}</FormAlert>}
    </div>
  );
}

function AnswerForm({
  contactId,
  from,
  table,
  fields,
  prefillBySystemKey,
  onBack,
  onDone,
  onMoved,
}: {
  contactId: string;
  from: ContactTable | null;
  table: ContactTable;
  fields: ContactField[];
  prefillBySystemKey?: Record<string, string>;
  onBack: () => void;
  onDone: () => void;
  onMoved: (result: MoveResult) => void;
}) {
  const t = useTranslations("contacts.move");
  const settings = useFormatSettings();
  const move = useMoveContact();
  const awardXp = useAwardXp();
  const [answers, setAnswers] = useState<Answers>(() =>
    initialAnswers(fields, settings, new Date(), prefillBySystemKey),
  );
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [failed, setFailed] = useState(false);
  const shown = useMemo(() => shownFields(fields, answers), [fields, answers]);

  function set(fieldId: string, value: Answers[string]) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const found = answerErrors(fields, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const { meetingBooked } = await move.mutateAsync({ contactId, from, table, fields, answers });
      onMoved({ table, meetingBooked });
      // Quiet, small reward for every move; no confetti, just a bit of XP. The
      // server finds the move (and the meeting it booked) it has not paid for yet.
      awardXp.mutate({ reason: "contact_moved" });
      if (meetingBooked) awardXp.mutate({ reason: "meeting_booked" });
    } catch (error) {
      // The database names the question it refused.
      const { message, details } = (error ?? {}) as { message?: string; details?: string };
      if (details && shown.some((field) => field.id === details)) {
        setErrors({ [details]: message?.includes("answer_required") ? "required" : "invalid" });
      } else {
        setFailed(true);
      }
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          {t("changeTable")}
        </Button>
      </div>
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <span
          aria-hidden
          className={cn("size-2.5 shrink-0 rounded-full", toneFill[tableTone(table.color)])}
        />
        {t("movingTo", { name: table.name })}
      </p>

      {shown.length === 0 && <p className="text-sm text-ink-muted">{t("noQuestions")}</p>}
      {shown.map((field) => (
        <AnswerField
          key={field.id}
          field={field}
          value={answers[field.id]}
          error={errors[field.id]}
          onChange={(value) => set(field.id, value)}
        />
      ))}

      {failed && <FormAlert>{t("moveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={move.isPending}>
          {t("confirm", { name: table.name })}
        </Button>
      </div>
    </form>
  );
}

/**
 * After a move into Domluvená schůzka or Klient má zájem: one tap makes the
 * deal (prefilled from the contact), and it takes the meeting just booked.
 */
function DealOffer({
  contact,
  result,
  onDone,
  onCreated,
}: {
  contact: DealContact;
  result: MoveResult;
  onDone: () => void;
  onCreated: (deal: { id: string; title: string }) => void;
}) {
  const t = useTranslations("contacts.move.dealOffer");
  const [making, setMaking] = useState(false);

  if (making) {
    return (
      <NewDealFromContactForm
        contact={contact}
        source="cold_calling"
        linkMeeting={result.meetingBooked}
        cancelLabel={t("later")}
        onCancel={onDone}
        onCreated={onCreated}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert tone="success">
        {result.meetingBooked
          ? t("movedWithMeeting", { name: result.table.name })
          : t("moved", { name: result.table.name })}
      </FormAlert>
      <p className="text-sm text-ink-soft">
        {t(result.meetingBooked ? "questionMeeting" : "question")}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("later")}
        </Button>
        <Button type="button" autoFocus onClick={() => setMaking(true)}>
          <BriefcaseBusinessIcon aria-hidden data-icon="inline-start" />
          {t("create")}
        </Button>
      </div>
    </div>
  );
}

function AnswerField({
  field,
  value,
  error,
  onChange,
}: {
  field: ContactField;
  value: Answers[string];
  error: AnswerError | undefined;
  onChange: (value: Answers[string]) => void;
}) {
  const t = useTranslations("contacts.move");
  const settings = useFormatSettings();
  const id = `answer-${field.id}`;
  const message = error ? t(`errors.${error}`) : undefined;
  const a11y = {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-message` : undefined,
    "aria-required": field.required || undefined,
  } as const;
  const label = (
    <>
      {field.label}
      {field.required && (
        <span className="ml-1 text-pink" aria-hidden>
          *
        </span>
      )}
    </>
  );
  const text = typeof value === "string" ? value : "";

  if (field.type === "select" || field.type === "boolean") {
    const choices =
      field.type === "select"
        ? fieldOptions(field.options).map((option) => ({ value: option.key, label: option.label }))
        : [
            { value: true, label: t("yes") },
            { value: false, label: t("no") },
          ];
    return (
      <fieldset className="flex flex-col gap-2" {...a11y}>
        <legend className="mb-2 text-sm font-medium text-ink-soft">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={String(choice.value)}
              type="button"
              aria-pressed={value === choice.value}
              // A second tap on the chosen answer clears an optional question.
              onClick={() =>
                onChange(value === choice.value && !field.required ? undefined : choice.value)
              }
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                value === choice.value
                  ? "border-violet/60 bg-violet/15 text-ink"
                  : "border-line text-ink-soft hover:text-ink",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {message && (
          <p id={`${id}-message`} className="text-xs text-pink" aria-live="polite">
            {message}
          </p>
        )}
      </fieldset>
    );
  }

  const todayButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        const today = todayIsoDate(settings);
        if (field.type === "date") {
          onChange(today);
          return;
        }
        // Keep the time already picked; otherwise the time is now.
        const time = text
          ? instantToZonedParts(new Date(text), settings.timeZone).time
          : instantToZonedParts(new Date(), settings.timeZone).time;
        onChange(zonedWallClockToInstant(today, time, settings.timeZone).toISOString());
      }}
    >
      {t("today")}
    </Button>
  );

  return (
    <FormField
      id={id}
      label={label}
      error={message}
      aside={field.type === "date" || field.type === "datetime" ? todayButton : undefined}
    >
      {field.type === "long_text" ? (
        <Textarea
          id={id}
          {...a11y}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === "date" ? (
        <DatePicker
          id={id}
          value={text || null}
          placeholder={t("pickDate")}
          onValueChange={(next) => onChange(next ?? undefined)}
        />
      ) : field.type === "datetime" ? (
        <DateTimePicker
          id={id}
          value={text || null}
          datePlaceholder={t("pickDate")}
          timeLabel={t("time")}
          invalid={Boolean(error)}
          describedBy={error ? `${id}-message` : undefined}
          onValueChange={(next) => onChange(next ?? undefined)}
        />
      ) : (
        <Input id={id} {...a11y} value={text} onChange={(event) => onChange(event.target.value)} />
      )}
    </FormField>
  );
}
