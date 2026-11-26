"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon, CalendarCheckIcon, UserRoundIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AnswerField } from "@/features/contacts/move-contact-dialog";
import {
  answerErrors,
  answersToSave,
  initialAnswers,
  shownFields,
  type AnswerError,
  type Answers,
} from "@/features/contacts/move-form";
import { MEETING_FIELD_KEY, type ContactField } from "@/features/contacts/types";
import { formatSlotMoment } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { BookingDialogSource } from "../analytics";
import {
  extendAppHoldAction,
  holdAppSlotAction,
  releaseAppHoldAction,
} from "../app-booking-actions";
import { emailDefault } from "../meeting-plan";
import {
  MeetingError,
  trackDialogOpened,
  useAppSlots,
  useBookForContact,
  useMeetingSetup,
} from "../meeting-queries";
import type { AppBookingProblem, BookForContactResult } from "../server/app-booking";
import { useDurationText } from "./common";
import { QuickHoursSetup } from "./quick-hours-setup";
import { SlotPicker } from "./slot-picker";

/** A hold lasts five minutes; the dialog renews it well before. */
const RENEW_MS = 4 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Hold = { holdId: string; holdToken: string; start: number; forced: boolean };

/**
 * Booking a meeting for a contact in the app (30.4): whose meeting (by the
 * owner's Cold Calling settings), of which type, a time in the shared picker
 * (the host's free and taken times by their own scheduler, held while the
 * dialog is open), the guest's confirmation e-mail, and the other questions
 * of "Meeting scheduled". The same form in Cold Calling's move, in a
 * contact's and a deal's "Schedule a meeting".
 */
export function MeetingBookingForm({
  contactId,
  dealId = null,
  from,
  fields = [],
  onBack,
  onCancel,
  onBooked,
}: {
  contactId: string;
  dealId?: string | null;
  from: BookingDialogSource;
  /** The questions of "Meeting scheduled" (its time is the picker). */
  fields?: ContactField[];
  onBack?: () => void;
  onCancel: () => void;
  onBooked: (result: BookForContactResult) => void;
}) {
  const t = useTranslations("scheduler.meeting");
  const locale = useLocale();
  const settings = useFormatSettings();
  const durationText = useDurationText();
  const setup = useMeetingSetup(contactId);
  const book = useBookForContact();
  const [hostId, setHostId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [holding, setHolding] = useState(false);
  const [conflict, setConflict] = useState<number | null>(null);
  const [problem, setProblem] = useState<AppBookingProblem | null>(null);
  const [sendEmail, setSendEmail] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const questions = useMemo(
    () => fields.filter((field) => field.system_key !== MEETING_FIELD_KEY),
    [fields],
  );
  const [answers, setAnswers] = useState<Answers>(() =>
    initialAnswers(questions, settings, new Date()),
  );
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const shown = useMemo(() => shownFields(questions, answers), [questions, answers]);

  const data = setup.data;
  const host = data?.hosts.find((item) => item.userId === (hostId ?? data.defaultHost)) ?? null;
  const type =
    host?.types.find((item) => item.id === (typeId ?? host.defaultTypeId)) ??
    host?.types[0] ??
    null;
  const slots = useAppSlots(host?.userId ?? null, type?.id ?? null, settings.timeZone);
  const moves = data
    ? data.contact.tableKey !== "meeting_scheduled" && data.contact.tableKey !== "clients"
    : false;
  const emailing = sendEmail ?? emailDefault(data?.contact.email);

  // The hold of the open dialog: renewed while it stays, freed when it goes.
  const holdRef = useRef<Hold | null>(null);
  holdRef.current = hold;
  useEffect(() => {
    return () => {
      const current = holdRef.current;
      if (current)
        void releaseAppHoldAction({ holdId: current.holdId, holdToken: current.holdToken });
    };
  }, []);
  useEffect(() => {
    if (!hold) return;
    const timer = window.setInterval(async () => {
      const result = await extendAppHoldAction({ holdId: hold.holdId, holdToken: hold.holdToken });
      if (!result.ok) {
        setHold(null);
        setProblem("holdExpired");
      }
    }, RENEW_MS);
    return () => window.clearInterval(timer);
  }, [hold]);

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !data) return;
    opened.current = true;
    trackDialogOpened(from, data.missing === "selfSetup" && data.hosts.length === 0);
  }, [data, from]);

  function releaseHold() {
    const current = holdRef.current;
    if (current)
      void releaseAppHoldAction({ holdId: current.holdId, holdToken: current.holdToken });
    setHold(null);
  }

  async function take(start: number, force: boolean) {
    if (!host || !type) return;
    setHolding(true);
    setProblem(null);
    setConflict(null);
    try {
      const result = await holdAppSlotAction({
        hostId: host.userId,
        typeId: type.id,
        start,
        force,
        release: holdRef.current?.holdId ?? null,
        from,
      });
      if (result.ok) {
        setHold({
          holdId: result.data.holdId,
          holdToken: result.data.holdToken,
          start,
          forced: force,
        });
      } else if (result.problem === "busy") {
        setHold(null);
        setConflict(start);
        void slots.refetch();
      } else {
        setHold(null);
        setProblem(result.problem);
      }
    } finally {
      setHolding(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!hold || !data) return;
    setProblem(null);
    const found = moves ? answerErrors(questions, answers) : {};
    setErrors(found);
    const typed = email.trim();
    const needsTyped = emailing && !data.contact.email;
    const badEmail = needsTyped && !EMAIL.test(typed);
    setEmailError(badEmail);
    if (Object.keys(found).length || badEmail) return;
    try {
      const result = await book.mutateAsync({
        holdId: hold.holdId,
        holdToken: hold.holdToken,
        contactId,
        dealId,
        sendEmail: emailing,
        email: needsTyped ? typed : null,
        answers: moves ? answersToSave(questions, answers) : {},
        forced: hold.forced,
        from,
        locale: locale === "en" ? "en" : "cs",
        timeZone: settings.timeZone,
      });
      holdRef.current = null;
      setHold(null);
      onBooked(result);
    } catch (error) {
      if (error instanceof MeetingError) {
        if (error.problem === "busy") {
          setConflict(hold.start);
          return;
        }
        const [kind, field] = (error.details ?? "").split(":");
        if (field && shown.some((item) => item.id === field)) {
          setErrors({ [field]: kind === "required" ? "required" : "invalid" });
          return;
        }
        setProblem(error.problem);
        if (error.problem === "holdExpired") setHold(null);
        return;
      }
      setProblem("unknown");
    }
  }

  if (
    settingUp ||
    (data && data.canSetup && data.missing === "selfSetup" && data.hosts.length === 0)
  ) {
    return (
      <QuickHoursSetup
        onBack={settingUp ? () => setSettingUp(false) : onBack}
        onCancel={onCancel}
        onDone={() => {
          setSettingUp(false);
          void setup.refetch();
        }}
      />
    );
  }

  if (setup.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (setup.isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert>{t("setupFailed")}</FormAlert>
        <Button variant="ghost" className="self-end" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    );
  }

  if (!host || !type) {
    return (
      <div className="flex flex-col gap-4" data-testid="meeting-no-host">
        <FormAlert>{t(data.missing === "hostMissing" ? "hostMissing" : "noHost")}</FormAlert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onBack && (
            <Button variant="ghost" onClick={onBack}>
              {t("back")}
            </Button>
          )}
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  const typeLocked = data.settings.typeLocked;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5"
      data-testid="meeting-booking"
    >
      {onBack && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          {t("changeTable")}
        </Button>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="meeting-host" label={t("host")}>
          {data.canPickHost ? (
            <Select
              value={host.userId}
              items={data.hosts.map((item) => ({
                value: item.userId,
                label: item.isSelf ? t("me", { name: item.name }) : item.name,
              }))}
              onValueChange={(next) => {
                if (typeof next !== "string" || next === host.userId) return;
                releaseHold();
                setHostId(next);
                setTypeId(null);
              }}
            >
              <SelectTrigger id="meeting-host" data-testid="meeting-host">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.hosts.map((item) => (
                  <SelectItem key={item.userId} value={item.userId}>
                    {item.isSelf ? t("me", { name: item.name }) : item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p
              id="meeting-host"
              data-testid="meeting-host"
              className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm text-ink"
            >
              <UserRoundIcon aria-hidden className="size-4 text-ink-muted" />
              {host.isSelf ? t("me", { name: host.name }) : host.name}
            </p>
          )}
        </FormField>
        <FormField id="meeting-type" label={t("type")}>
          {typeLocked || host.types.length < 2 ? (
            <p
              id="meeting-type"
              className="flex min-h-11 items-center rounded-xl border border-line px-3 text-sm text-ink"
            >
              {t("typeLine", { name: type.name, duration: durationText(type.durationMin) })}
            </p>
          ) : (
            <Select
              value={type.id}
              items={host.types.map((item) => ({
                value: item.id,
                label: t("typeLine", { name: item.name, duration: durationText(item.durationMin) }),
              }))}
              onValueChange={(next) => {
                if (typeof next !== "string" || next === type.id) return;
                releaseHold();
                setTypeId(next);
              }}
            >
              <SelectTrigger id="meeting-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {host.types.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {t("typeLine", { name: item.name, duration: durationText(item.durationMin) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      {data.missing === "selfSetup" && data.canSetup && (
        <button
          type="button"
          onClick={() => setSettingUp(true)}
          className="self-start text-sm text-violet underline-offset-4 hover:underline"
        >
          {t("setupMine")}
        </button>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="meeting-when">
        <h3 id="meeting-when" className="micro-label">
          {host.isSelf ? t("whenSelf") : t("whenOther", { name: host.name })}
        </h3>
        {slots.isPending ? (
          <Skeleton className="h-72 rounded-2xl" />
        ) : slots.isError ? (
          <FormAlert>{t("slotsFailed")}</FormAlert>
        ) : (
          <SlotPicker
            days={slots.data.days}
            timeZone={slots.data.timeZone}
            selected={hold?.start ?? null}
            disabled={holding || book.isPending}
            manualEntry
            onPick={(slot) => void take(slot.start, false)}
            onForce={(start) => void take(start, true)}
          />
        )}
        {conflict !== null && (
          <div
            role="status"
            data-testid="meeting-conflict"
            className="flex flex-col gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {t("conflict", { when: formatSlotMoment(new Date(conflict), settings, locale) })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="meeting-force"
              disabled={holding}
              onClick={() => void take(conflict, true)}
            >
              {t("bookAnyway")}
            </Button>
          </div>
        )}
        {hold && (
          <p
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
              hold.forced
                ? "border-gold/40 bg-gold/10 text-ink"
                : "border-violet/40 bg-violet/10 text-ink",
            )}
            data-testid="meeting-held"
            data-start={hold.start}
            data-forced={hold.forced}
          >
            <CalendarCheckIcon aria-hidden className="size-4 shrink-0 text-violet" />
            <span>
              {t(hold.forced ? "heldForced" : "held", {
                when: formatSlotMoment(new Date(hold.start), settings, locale),
                duration: durationText(type.durationMin),
              })}
            </span>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="meeting-email" className="text-sm font-medium text-ink">
              {t("sendEmail")}
            </label>
            <p className="text-[13px] text-ink-muted">
              {data.contact.email
                ? t("sendEmailTo", { email: data.contact.email })
                : t("sendEmailNone")}
            </p>
          </div>
          <Switch
            id="meeting-email"
            data-testid="meeting-email"
            checked={emailing}
            onCheckedChange={(checked) => setSendEmail(checked)}
          />
        </div>
        {emailing && !data.contact.email && (
          <FormField
            id="meeting-email-address"
            label={t("emailAddress")}
            error={emailError ? t("emailInvalid") : undefined}
          >
            <Input
              id="meeting-email-address"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              aria-invalid={emailError || undefined}
              onChange={(next) => {
                setEmail(next.target.value);
                setEmailError(false);
              }}
            />
          </FormField>
        )}
      </section>

      {moves && shown.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-line pt-4">
          {shown.map((field) => (
            <AnswerField
              key={field.id}
              field={field}
              value={answers[field.id]}
              error={errors[field.id]}
              onChange={(value) => {
                setAnswers((current) => ({ ...current, [field.id]: value }));
                setErrors((current) => {
                  const next = { ...current };
                  delete next[field.id];
                  return next;
                });
              }}
            />
          ))}
        </section>
      )}

      {problem && <FormAlert>{t(`problems.${problemKey(problem)}`)}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!hold || holding || book.isPending}
          data-testid="meeting-submit"
          data-tutorial="meeting-submit"
        >
          {book.isPending ? t("booking") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

const PROBLEM_KEYS = [
  "holdExpired",
  "slotTaken",
  "readOnly",
  "forbidden",
  "noHost",
  "noContact",
  "noEmail",
  "invalid",
] as const;

function problemKey(problem: AppBookingProblem): (typeof PROBLEM_KEYS)[number] | "unknown" {
  return (PROBLEM_KEYS as readonly string[]).includes(problem)
    ? (problem as (typeof PROBLEM_KEYS)[number])
    : "unknown";
}
