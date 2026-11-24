"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  LoaderCircleIcon,
  NotebookPenIcon,
  SparklesIcon,
  UndoIcon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyPicker } from "@/components/ui/currency-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import type { ActionCard } from "@/features/grady/actions";
import { postGradyJob } from "@/features/grady/queries";
import { useApplyActionCard, useDecideAction } from "@/features/grady/use-action-cards";
import { track } from "@/lib/analytics/client";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  MEETING_FILE_EXTENSIONS,
  MEETING_FILE_MAX_BYTES,
  MEETING_TEXT_MAX,
  MEETING_TEXT_MIN,
  type MeetingApply,
  type MeetingProposal,
  type MeetingTarget,
  type ProposedContact,
  type ProposedTask,
} from "./logic";

type Step =
  | { kind: "input" }
  | { kind: "reading" }
  | { kind: "proposal"; proposal: MeetingProposal }
  | { kind: "applying"; proposal: MeetingProposal }
  | { kind: "done"; card: ActionCard; changes: number };

/** The ticks and edits of the proposal, all in one place. */
type Draft = {
  summary: { on: boolean; text: string };
  tasks: Array<ProposedTask & { on: boolean }>;
  stage: { on: boolean; id: string | null };
  closeDate: { on: boolean; value: string | null };
  amount: { on: boolean; value: string; currency: string };
  contacts: Array<ProposedContact & { on: boolean }>;
  note: { on: boolean; title: string; text: string };
  transcript: boolean;
};

function draftOf(proposal: MeetingProposal): Draft {
  return {
    summary: { on: Boolean(proposal.summary), text: proposal.summary ?? "" },
    tasks: proposal.tasks.map((task) => ({ ...task, on: true })),
    stage: { on: proposal.stageId !== null, id: proposal.stageId },
    closeDate: { on: proposal.closeDate !== null, value: proposal.closeDate },
    amount: {
      on: proposal.amount !== null,
      value: proposal.amount ? String(proposal.amount.value) : "",
      currency: proposal.amount?.currency ?? proposal.deal?.currency ?? "EUR",
    },
    contacts: proposal.contacts.map((contact) => ({ ...contact, on: true })),
    note: {
      on: Boolean(proposal.note),
      title: proposal.note?.title ?? "",
      text: proposal.note?.text ?? "",
    },
    // Kept with the deal only when the user asks for it.
    transcript: false,
  };
}

/** The ticked parts as the server takes them; null when a ticked amount is not a number. */
function applyOf(
  proposal: MeetingProposal,
  draft: Draft,
  text: string,
  name: string,
): MeetingApply | null {
  const amount = draft.amount.on
    ? Number(draft.amount.value.replace(/\s/g, "").replace(",", "."))
    : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return null;
  return {
    target: proposal.target,
    dealId: proposal.deal?.id ?? null,
    contactId: proposal.contact?.id ?? null,
    summary: draft.summary.on && draft.summary.text.trim() ? draft.summary.text.trim() : null,
    tasks: draft.tasks
      .filter((task) => task.on && task.title.trim())
      .map((task) => ({
        title: task.title.trim(),
        dueAt: task.dueAt,
        assigneeId: task.assigneeId,
        durationMinutes: task.durationMinutes,
      })),
    stageId: draft.stage.on ? draft.stage.id : null,
    closeDate: draft.closeDate.on ? draft.closeDate.value : null,
    amount: amount !== null ? { value: amount, currency: draft.amount.currency } : null,
    contacts: draft.contacts
      .filter((contact) => contact.on)
      .map(({ firstName, lastName, companyName, email, phone, role }) => ({
        firstName,
        lastName,
        companyName,
        email,
        phone,
        role,
      })),
    note:
      draft.note.on && draft.note.title.trim()
        ? { title: draft.note.title.trim(), text: draft.note.text }
        : null,
    transcript: draft.transcript && proposal.deal ? { name, text } : null,
  };
}

function ticked(apply: MeetingApply | null): number {
  if (!apply) return 0;
  return (
    (apply.summary ? 1 : 0) +
    (apply.closeDate || apply.amount ? 1 : 0) +
    (apply.stageId ? 1 : 0) +
    apply.contacts.length +
    apply.tasks.length +
    (apply.note ? 1 : 0) +
    (apply.transcript ? 1 : 0)
  );
}

/**
 * "Paste meeting notes" (28.7) at a deal, a contact or a calendar meeting:
 * the transcript or notes go in (typed, pasted or from a .txt / .docx /
 * .pdf), Grady proposes the changes, the user ticks and edits them and
 * confirms; everything is made at once and comes back with one Undo.
 * Nothing is written before Confirm.
 */
export function MeetingNotesButton({
  target,
  className,
  size,
}: {
  target: MeetingTarget;
  className?: string;
  size?: "sm" | "default";
}) {
  const t = useTranslations("meetingNotes");
  const [open, setOpen] = useState(false);
  const workspace = useWorkspace();
  const tasks = useCan("tasks", "create");
  const pipeline = useCan("pipeline", "update");
  const contacts = useCan("contacts", "update");
  const calendar = useCan("calendar", "view");
  const section =
    target.kind === "deal" ? pipeline : target.kind === "contact" ? contacts : calendar;
  if (workspace.readOnly || !(tasks || section)) return null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        className={className}
        data-testid="meeting-notes-open"
        onClick={() => {
          setOpen(true);
          track("meeting_notes_opened", { from: target.kind });
        }}
      >
        <NotebookPenIcon aria-hidden data-icon="inline-start" />
        {t("open")}
      </Button>
      {open && <MeetingNotesDialog target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

function MeetingNotesDialog({ target, onClose }: { target: MeetingTarget; onClose: () => void }) {
  const t = useTranslations("meetingNotes");
  const format = useFormatSettings();
  const apply = useApplyActionCard();
  const decide = useDecideAction();
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [undone, setUndone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const errorText = (code: string) =>
    t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t("errors.unknown");

  async function readFile(file: File) {
    setError(null);
    if (file.size > MEETING_FILE_MAX_BYTES) {
      setError(errorText("fileTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/meeting-notes/extract", { method: "POST", body });
      const json = (await response.json().catch(() => null)) as
        { ok: true; text: string; truncated: boolean } | { ok: false; code: string } | null;
      if (!json?.ok) {
        setError(errorText(json && !json.ok ? json.code : "unknown"));
        return;
      }
      setText(json.text);
      setFileName(file.name);
      if (json.truncated) setError(t("truncated"));
    } catch {
      setError(errorText("network"));
    } finally {
      setUploading(false);
    }
  }

  async function analyze() {
    setError(null);
    setStep({ kind: "reading" });
    const result = await postGradyJob<{ proposal: MeetingProposal }>({
      kind: "meetingNotes",
      target,
      text,
    });
    if (!result.ok) {
      setError(errorText(result.code));
      setStep({ kind: "input" });
      return;
    }
    setDraft(draftOf(result.proposal));
    setStep({ kind: "proposal", proposal: result.proposal });
  }

  const proposal = step.kind === "proposal" || step.kind === "applying" ? step.proposal : null;
  const transcriptName = fileName ?? t("transcriptName");
  const payload = proposal && draft ? applyOf(proposal, draft, text, transcriptName) : null;
  const count = ticked(payload);

  async function confirm() {
    if (!proposal || !payload) return;
    setError(null);
    setStep({ kind: "applying", proposal });
    const result = await postGradyJob<{ card: ActionCard }>({
      kind: "meetingNotesApply",
      apply: payload,
    });
    if (!result.ok) {
      setError(errorText(result.code));
      setStep({ kind: "proposal", proposal });
      return;
    }
    apply(result.card, { awards: true });
    setStep({ kind: "done", card: result.card, changes: count });
  }

  function undoAll() {
    if (step.kind !== "done") return;
    setError(null);
    decide.mutate(
      { kind: "undoAction", id: step.card.id },
      {
        onSuccess: () => setUndone(true),
        onError: (cause) => setError(errorText((cause as { code?: string }).code ?? "unknown")),
      },
    );
  }

  const patch = (change: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...change } : current));

  return (
    <ResponsiveDialog
      open
      onOpenChange={(next) => !next && step.kind !== "applying" && onClose()}
      title={t("title")}
      closeLabel={t("close")}
      className="md:w-[min(100vw-32px,720px)]"
    >
      <div className="flex flex-col gap-4" data-testid="meeting-notes-dialog">
        {error && <FormAlert>{error}</FormAlert>}

        {(step.kind === "input" || step.kind === "reading") && (
          <>
            <p className="text-sm text-ink-soft">{t("intro")}</p>
            <Textarea
              aria-label={t("textLabel")}
              placeholder={t("placeholder")}
              value={text}
              maxLength={MEETING_TEXT_MAX}
              disabled={step.kind === "reading"}
              onChange={(event) => {
                setText(event.target.value);
                setFileName(null);
              }}
              className="min-h-56 font-mono text-xs leading-relaxed"
              data-testid="meeting-notes-text"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>
                {t("length", { chars: formatNumber(text.length, {}, format) })}
                {fileName ? ` · ${fileName}` : ""}
              </span>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={MEETING_FILE_EXTENSIONS.join(",")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readFile(file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={uploading || step.kind === "reading"}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <LoaderCircleIcon
                    aria-hidden
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <UploadIcon aria-hidden data-icon="inline-start" />
                )}
                {t("upload")}
              </Button>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={step.kind === "reading"}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                data-testid="meeting-notes-analyze"
                disabled={text.trim().length < MEETING_TEXT_MIN || step.kind === "reading"}
                onClick={() => void analyze()}
              >
                {step.kind === "reading" ? (
                  <LoaderCircleIcon
                    aria-hidden
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <SparklesIcon aria-hidden data-icon="inline-start" />
                )}
                {step.kind === "reading" ? t("reading") : t("analyze")}
              </Button>
            </div>
          </>
        )}

        {proposal && draft && (
          <ProposalView
            proposal={proposal}
            draft={draft}
            onChange={patch}
            disabled={step.kind === "applying"}
          />
        )}
        {proposal && draft && (
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={step.kind === "applying"}
              onClick={() => setStep({ kind: "input" })}
            >
              {t("back")}
            </Button>
            <Button
              type="button"
              data-testid="meeting-notes-apply"
              disabled={!payload || count === 0 || step.kind === "applying"}
              onClick={() => void confirm()}
            >
              {step.kind === "applying" && (
                <LoaderCircleIcon
                  aria-hidden
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {t("apply", { count })}
            </Button>
          </div>
        )}

        {step.kind === "done" && (
          <div className="flex flex-col gap-4" data-testid="meeting-notes-done">
            <FormAlert tone="success">
              {undone ? t("undone") : t("done", { count: step.changes })}
            </FormAlert>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {!undone && step.card.undoable && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={undoAll}
                  data-testid="meeting-notes-undo"
                >
                  <UndoIcon aria-hidden data-icon="inline-start" />
                  {t("undo")}
                </Button>
              )}
              <Button type="button" onClick={onClose}>
                {t("close")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

function Section({
  checked,
  onChecked,
  label,
  disabled,
  children,
}: {
  checked: boolean;
  onChecked: (value: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3 rounded-2xl border border-line p-3", !checked && "opacity-70")}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChecked(Boolean(value))}
        aria-label={typeof label === "string" ? label : undefined}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-sm font-medium text-ink">{label}</div>
        {checked && children}
      </div>
    </div>
  );
}

function ProposalView({
  proposal,
  draft,
  onChange,
  disabled,
}: {
  proposal: MeetingProposal;
  draft: Draft;
  onChange: (change: Partial<Draft>) => void;
  disabled: boolean;
}) {
  const t = useTranslations("meetingNotes");
  const { rights, people, stages, deal } = proposal;
  const peopleItems = people.map((person) => ({ value: person.id, label: person.name }));
  const stageItems = stages.map((stage) => ({ value: stage.id, label: stage.name }));
  const stageName = (id: string | null) => stages.find((stage) => stage.id === id)?.name ?? "";
  const setTask = (key: string, change: Partial<ProposedTask & { on: boolean }>) =>
    onChange({
      tasks: draft.tasks.map((task) => (task.key === key ? { ...task, ...change } : task)),
    });
  const setContact = (key: string, change: Partial<ProposedContact & { on: boolean }>) =>
    onChange({
      contacts: draft.contacts.map((contact) =>
        contact.key === key ? { ...contact, ...change } : contact,
      ),
    });

  return (
    <div className="flex flex-col gap-3" data-testid="meeting-notes-proposal">
      <p className="text-sm text-ink-soft">
        {t("proposalIntro")}
        {proposal.parts > 1 ? ` ${t("parts", { count: proposal.parts })}` : ""}
        {proposal.truncated ? ` ${t("truncated")}` : ""}
      </p>

      {proposal.summary !== null && (
        <Section
          checked={draft.summary.on}
          onChecked={(on) => onChange({ summary: { ...draft.summary, on } })}
          label={deal ? t("summaryDeal") : t("summaryContact")}
          disabled={disabled}
        >
          <Textarea
            aria-label={t("summaryLabel")}
            value={draft.summary.text}
            disabled={disabled}
            onChange={(event) =>
              onChange({ summary: { ...draft.summary, text: event.target.value } })
            }
            className="min-h-24 text-sm"
          />
        </Section>
      )}

      {draft.tasks.map((task) => (
        <Section
          key={task.key}
          checked={task.on}
          onChecked={(on) => setTask(task.key, { on })}
          label={task.nextStep ? t("nextStep") : t("task")}
          disabled={disabled}
        >
          <Input
            aria-label={t("taskTitle")}
            value={task.title}
            disabled={disabled}
            onChange={(event) => setTask(task.key, { title: event.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <DateTimePicker
              value={task.dueAt}
              onValueChange={(dueAt) => setTask(task.key, { dueAt })}
              timeLabel={t("time")}
              datePlaceholder={t("dueDefault")}
            />
            {rights.assignOthers && peopleItems.length > 1 ? (
              <Select
                value={task.assigneeId ?? ""}
                items={[{ value: "", label: t("assigneeMe") }, ...peopleItems]}
                disabled={disabled}
                onValueChange={(value) =>
                  setTask(task.key, {
                    assigneeId: typeof value === "string" && value ? value : null,
                  })
                }
              >
                <SelectTrigger aria-label={t("assignee")} className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("assigneeMe")}</SelectItem>
                  {peopleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </Section>
      ))}

      {proposal.stageId !== null && deal && (
        <Section
          checked={draft.stage.on}
          onChecked={(on) => onChange({ stage: { ...draft.stage, on } })}
          label={t("stage", { from: stageName(deal.stageId), to: stageName(draft.stage.id) })}
          disabled={disabled}
        >
          <Select
            value={draft.stage.id ?? ""}
            items={stageItems}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({ stage: { ...draft.stage, id: typeof value === "string" ? value : null } })
            }
          >
            <SelectTrigger aria-label={t("stageLabel")} className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      )}

      {proposal.closeDate !== null && (
        <Section
          checked={draft.closeDate.on}
          onChecked={(on) => onChange({ closeDate: { ...draft.closeDate, on } })}
          label={t("closeDate")}
          disabled={disabled}
        >
          <DatePicker
            value={draft.closeDate.value}
            onValueChange={(value) => onChange({ closeDate: { ...draft.closeDate, value } })}
            disabled={disabled}
          />
        </Section>
      )}

      {proposal.amount !== null && (
        <Section
          checked={draft.amount.on}
          onChecked={(on) => onChange({ amount: { ...draft.amount, on } })}
          label={t("amount")}
          disabled={disabled}
        >
          <div className="flex gap-2">
            <Input
              aria-label={t("amount")}
              inputMode="decimal"
              value={draft.amount.value}
              disabled={disabled}
              onChange={(event) =>
                onChange({ amount: { ...draft.amount, value: event.target.value } })
              }
            />
            <CurrencyPicker
              id="meeting-notes-currency"
              value={draft.amount.currency}
              onChange={(currency) => onChange({ amount: { ...draft.amount, currency } })}
              compact
              ariaLabel={t("currency")}
              disabled={disabled}
            />
          </div>
        </Section>
      )}

      {draft.contacts.map((contact) => (
        <Section
          key={contact.key}
          checked={contact.on}
          onChecked={(on) => setContact(contact.key, { on })}
          label={deal && rights.linkContacts ? t("contactOnDeal") : t("contact")}
          disabled={disabled}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label={t("firstName")}
              placeholder={t("firstName")}
              value={contact.firstName}
              disabled={disabled}
              onChange={(event) => setContact(contact.key, { firstName: event.target.value })}
            />
            <Input
              aria-label={t("lastName")}
              placeholder={t("lastName")}
              value={contact.lastName}
              disabled={disabled}
              onChange={(event) => setContact(contact.key, { lastName: event.target.value })}
            />
            <Input
              aria-label={t("company")}
              placeholder={t("company")}
              value={contact.companyName}
              disabled={disabled}
              onChange={(event) => setContact(contact.key, { companyName: event.target.value })}
            />
            <Input
              aria-label={t("email")}
              placeholder={t("email")}
              type="email"
              value={contact.email}
              disabled={disabled}
              onChange={(event) => setContact(contact.key, { email: event.target.value })}
            />
            {contact.role && <p className="text-xs text-ink-muted sm:col-span-2">{contact.role}</p>}
          </div>
        </Section>
      ))}

      {proposal.note !== null && (
        <Section
          checked={draft.note.on}
          onChecked={(on) => onChange({ note: { ...draft.note, on } })}
          label={rights.linkNote ? t("noteLinked") : t("note")}
          disabled={disabled}
        >
          <Input
            aria-label={t("noteTitle")}
            value={draft.note.title}
            disabled={disabled}
            onChange={(event) => onChange({ note: { ...draft.note, title: event.target.value } })}
          />
          <Textarea
            aria-label={t("noteText")}
            value={draft.note.text}
            disabled={disabled}
            onChange={(event) => onChange({ note: { ...draft.note, text: event.target.value } })}
            className="min-h-32 text-sm"
          />
        </Section>
      )}

      {rights.attachment && deal && (
        <Section
          checked={draft.transcript}
          onChecked={(on) => onChange({ transcript: on })}
          label={t("transcript")}
          disabled={disabled}
        />
      )}
    </div>
  );
}
