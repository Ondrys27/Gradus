"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { FileTextIcon, MailIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { toneFill } from "@/components/ui/tone";
import { useCan, useCanContacts } from "@/features/account/workspace-queries";
import { TargetTasks } from "@/features/crm-tasks/target-tasks";
import { useAssignees } from "@/features/crm-tasks/queries";
import { useAssigneeName } from "@/features/crm-tasks/use-assignee-name";
import { MoveContactDialog } from "@/features/contacts/move-contact-dialog";
import { useContact, useContactEntry, useContactTables } from "@/features/contacts/queries";
import { ComposeEmailDialog } from "@/features/email/compose-email-dialog";
import { emailSummary } from "@/features/email/types";
import { useCreateInvoiceFromDeal } from "@/features/invoices/queries";
import { invoicePath } from "@/features/invoices/types";
import { useInvoiceErrorText } from "@/features/invoices/use-invoice-error";
import { MentionedInNotes } from "@/features/notes/mentioned-in-notes";
import { WorkNotes } from "@/features/notes/work-notes";
import { CURRENCIES, currencyName, formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { DealActivityTimeline } from "./deal-activity-timeline";
import { DealContacts } from "./deal-contacts";
import { useDeleteDeal, usePatchDeal } from "./queries";
import {
  DESCRIPTION_MAX,
  parseAmount,
  REASON_MAX,
  TITLE_MAX,
  VALUE_MAX,
  type DealPatch,
} from "./schemas";
import { stageTone, type Deal, type Stage } from "./types";

/** Never a real contact; keeps a uuid column happy when the deal has none. */
const NIL_CONTACT_ID = "00000000-0000-0000-0000-000000000000";

type Props = {
  deal: Deal | null;
  stages: Stage[];
  onClose: () => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
};

const TABS = ["overview", "contacts", "tasks", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * Everything about a deal in one place: a large window in the middle on
 * larger screens, the whole screen on phones (sections as tabs there).
 * Every field saves on its own, like a document; nothing waits for a button.
 */
export function DealDetail({ deal, stages, onClose, onRequestMove }: Props) {
  const t = useTranslations("pipeline.detail");
  const isPhone = useIsPhone();

  // Keep the last deal on screen while the window closes.
  const [shown, setShown] = useState<Deal | null>(deal);
  if (deal && deal !== shown) setShown(deal);
  const current = deal ?? shown;

  return (
    <Dialog.Root open={deal !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed z-overlay flex flex-col overflow-hidden bg-surface shadow-popover outline-none",
            "transition-[opacity,scale,translate] duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0",
            isPhone
              ? "inset-0 pt-[env(safe-area-inset-top)] data-ending-style:translate-y-4 data-starting-style:translate-y-4"
              : "top-1/2 left-1/2 h-[min(90dvh,880px)] w-[min(100vw-32px,960px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line-strong data-ending-style:scale-[0.98] data-starting-style:scale-[0.98]",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
            <Dialog.Title className="micro-label">{t("title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {current && (
            <DetailBody
              key={current.id}
              deal={current}
              stages={stages}
              isPhone={isPhone}
              onClose={onClose}
              onRequestMove={onRequestMove}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailBody({
  deal,
  stages,
  isPhone,
  onClose,
  onRequestMove,
}: {
  deal: Deal;
  stages: Stage[];
  isPhone: boolean;
  onClose: () => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
}) {
  const t = useTranslations("pipeline.detail");
  const patch = usePatchDeal(deal.id);
  // Read-only without the right to edit (or after the trial); RLS decides anyway.
  const canEdit = useCan("pipeline", "edit");
  const [tab, setTab] = useState<Tab>("overview");
  const save = (change: DealPatch) => patch.mutate(change);

  const header = (
    <DealHeader
      deal={deal}
      stages={stages}
      canEdit={canEdit}
      compact={isPhone}
      onSave={save}
      onRequestMove={onRequestMove}
    />
  );
  const properties = (
    <DealProperties
      deal={deal}
      stages={stages}
      canEdit={canEdit}
      showStage={!isPhone}
      onSave={save}
      onRequestMove={onRequestMove}
    />
  );
  const contacts = <DealContacts dealId={deal.id} canEdit={canEdit} />;
  const tasks = (
    <TargetTasks
      kind="deal"
      id={deal.id}
      target={{ deal: { id: deal.id, title: deal.title }, contact: deal.contact }}
    />
  );
  const notes = <DealNotes deal={deal} canEdit={canEdit} onSave={save} onClose={onClose} />;
  const history = (
    <section aria-labelledby={`deal-history-${deal.id}`} className="flex flex-col gap-3">
      <h3 id={`deal-history-${deal.id}`} className="micro-label">
        {t("history")}
      </h3>
      <DealActivityTimeline deal={deal} />
    </section>
  );
  const actions = <DealActions deal={deal} onClose={onClose} />;
  const failed = patch.isError && <FormAlert>{t("saveFailed")}</FormAlert>;

  if (isPhone) {
    return (
      <>
        <div className="shrink-0 border-b border-line px-4 pb-0">
          {header}
          <div role="tablist" aria-label={t("sections")} className="-mx-1 mt-3 flex">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`deal-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`deal-panel-${key}`}
                onClick={() => setTab(key)}
                className={cn(
                  "relative min-h-11 flex-1 cursor-pointer px-1 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  tab === key ? "font-semibold text-ink" : "text-ink-muted",
                )}
              >
                {t(`tabs.${key}`)}
                {tab === key && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-violet"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`deal-panel-${tab}`}
          aria-labelledby={`deal-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]"
        >
          {failed}
          {tab === "overview" && (
            <>
              {properties}
              {notes}
              {actions}
            </>
          )}
          {tab === "contacts" && contacts}
          {tab === "tasks" && tasks}
          {tab === "history" && history}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div className="px-6 pb-5">
        {header}
        <div className="mt-4">{properties}</div>
        {failed && <div className="mt-3">{failed}</div>}
      </div>
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_288px] border-t border-line">
        <div className="flex min-w-0 flex-col gap-8 px-6 py-5">
          {contacts}
          {tasks}
          {history}
        </div>
        <aside className="flex flex-col gap-8 border-l border-line px-5 py-5">
          {notes}
          {actions}
        </aside>
      </div>
    </div>
  );
}

/** The deal's name, edited in place; a short status line under it. */
function DealHeader({
  deal,
  stages,
  canEdit,
  compact,
  onSave,
  onRequestMove,
}: {
  deal: Deal;
  stages: Stage[];
  canEdit: boolean;
  compact: boolean;
  onSave: (change: DealPatch) => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
}) {
  const t = useTranslations("pipeline.detail");
  const settings = useFormatSettings();
  const stage = stages.find((item) => item.id === deal.stage_id);
  return (
    <div className="flex flex-col gap-2">
      <TitleField deal={deal} canEdit={canEdit} onSave={onSave} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {compact && stage && (
          <StageSelect
            deal={deal}
            stages={stages}
            canEdit={canEdit}
            onRequestMove={onRequestMove}
            compact
          />
        )}
        {deal.won_at && (
          <StatusPill tone="green">
            {t("wonOn", { date: formatDate(new Date(deal.won_at), settings) })}
          </StatusPill>
        )}
        {deal.lost_at && (
          <StatusPill tone="pink">
            {t("lostOn", { date: formatDate(new Date(deal.lost_at), settings) })}
          </StatusPill>
        )}
        <span>{t("since", { date: formatDate(new Date(deal.entered_stage_at), settings) })}</span>
      </div>
    </div>
  );
}

/** Keeps a field's text in step with the deal while it is not being edited. */
function useSyncedText(value: string): [string, (next: string) => void] {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return [text, setText];
}

/**
 * Enter saves (by leaving the field). Esc with a change puts back what was
 * there and keeps the window open; Esc without one closes the window.
 */
function editKeys(dirty: boolean, onRevert: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape" && dirty) {
      event.stopPropagation();
      onRevert();
    }
  };
}

function TitleField({
  deal,
  canEdit,
  onSave,
}: {
  deal: Deal;
  canEdit: boolean;
  onSave: (change: DealPatch) => void;
}) {
  const t = useTranslations("pipeline");
  const [text, setText] = useSyncedText(deal.title);
  const [invalid, setInvalid] = useState(false);
  if (!canEdit) {
    return <h2 className="text-xl font-semibold break-words text-ink sm:text-2xl">{deal.title}</h2>;
  }
  function commit() {
    const clean = text.trim();
    if (!clean || clean.length > TITLE_MAX) {
      setInvalid(true);
      setText(deal.title);
      return;
    }
    setInvalid(false);
    if (clean !== deal.title) onSave({ title: clean });
  }
  return (
    <div className="flex flex-col gap-1">
      <input
        id="deal-title"
        value={text}
        maxLength={TITLE_MAX + 20}
        aria-label={t("form.name")}
        aria-invalid={invalid || undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={editKeys(text !== deal.title, () => setText(deal.title))}
        className="-mx-2 w-[calc(100%+16px)] rounded-xl border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-ink outline-none hover:border-line focus-visible:border-violet focus-visible:ring-3 focus-visible:ring-violet/25 sm:text-2xl"
      />
      {invalid && <p className="text-xs text-pink">{t("errors.titleRequired")}</p>}
    </div>
  );
}

function StageSelect({
  deal,
  stages,
  canEdit,
  onRequestMove,
  compact,
}: {
  deal: Deal;
  stages: Stage[];
  canEdit: boolean;
  onRequestMove: (deal: Deal, stage: Stage) => void;
  compact?: boolean;
}) {
  const t = useTranslations("pipeline.detail");
  const items = useMemo(
    () => stages.map((item) => ({ value: item.id, label: item.name })),
    [stages],
  );
  const stage = stages.find((item) => item.id === deal.stage_id);
  return (
    <Select
      value={deal.stage_id}
      items={items}
      disabled={!canEdit}
      onValueChange={(next) => {
        const target = stages.find((item) => item.id === next);
        if (target) onRequestMove(deal, target);
      }}
    >
      <SelectTrigger
        id={compact ? "deal-stage-compact" : "deal-stage"}
        aria-label={t("stage")}
        className={cn("text-sm mouse:min-h-9", compact && "min-h-9 w-auto rounded-full px-3")}
      >
        <span className="flex min-w-0 items-center gap-2">
          {stage && (
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", toneFill[stageTone(stage.color)])}
            />
          )}
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The deal's facts in a grid: stage (changed in place), value and currency,
 * Close Date, delivery date (it puts the deal in the calendar), who looks
 * after it and when it was made (read only).
 */
function DealProperties({
  deal,
  stages,
  canEdit,
  showStage,
  onSave,
  onRequestMove,
}: {
  deal: Deal;
  stages: Stage[];
  canEdit: boolean;
  /** On a phone the stage sits in the header above the tabs. */
  showStage: boolean;
  onSave: (change: DealPatch) => void;
  onRequestMove: (deal: Deal, stage: Stage) => void;
}) {
  const t = useTranslations("pipeline");
  const settings = useFormatSettings();
  const nameOf = useAssigneeName();

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
      {showStage && (
        <Property label={t("detail.stage")} htmlFor="deal-stage">
          <StageSelect
            deal={deal}
            stages={stages}
            canEdit={canEdit}
            onRequestMove={onRequestMove}
          />
        </Property>
      )}
      <Property label={t("form.amount")} htmlFor="deal-value">
        <ValueField deal={deal} canEdit={canEdit} onSave={onSave} />
      </Property>
      <Property label={t("detail.assignee")} htmlFor="deal-assignee">
        <AssigneeField deal={deal} canEdit={canEdit} onSave={onSave} />
      </Property>
      <Property label={t("form.closeDate")} htmlFor="deal-close">
        <DatePicker
          id="deal-close"
          value={deal.expected_close_date}
          disabled={!canEdit}
          placeholder={t("form.closeDatePlaceholder")}
          className="text-sm mouse:min-h-9"
          onValueChange={(next) => {
            if (next !== deal.expected_close_date) onSave({ expected_close_date: next });
          }}
        />
      </Property>
      <Property
        label={t("detail.deadline")}
        htmlFor="deal-deadline"
        hint={t("detail.deadlineHint")}
      >
        <DatePicker
          id="deal-deadline"
          value={deal.deadline_date}
          disabled={!canEdit}
          placeholder={t("form.closeDatePlaceholder")}
          className="text-sm mouse:min-h-9"
          onValueChange={(next) => {
            if (next !== deal.deadline_date) onSave({ deadline_date: next });
          }}
        />
      </Property>
      <Property label={t("detail.created")}>
        <p className="flex min-h-9 items-center gap-2 text-sm text-ink-soft">
          <span>{formatDate(new Date(deal.created_at), settings)}</span>
          {deal.created_by && (
            <span className="truncate text-ink-muted">· {nameOf(deal.created_by)}</span>
          )}
        </p>
      </Property>
    </dl>
  );
}

function Property({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="micro-label">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {children}
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </dd>
    </div>
  );
}

function ValueField({
  deal,
  canEdit,
  onSave,
}: {
  deal: Deal;
  canEdit: boolean;
  onSave: (change: DealPatch) => void;
}) {
  const t = useTranslations("pipeline");
  const locale = useLocale();
  const stored = deal.value === null ? "" : String(Number(deal.value)).replace(".", ",");
  const [text, setText] = useSyncedText(stored);
  const [invalid, setInvalid] = useState(false);
  const currencies = useMemo(
    () =>
      CURRENCIES.map((code) => ({ value: code, label: `${code} · ${currencyName(code, locale)}` })),
    [locale],
  );

  function commit() {
    const amount = parseAmount(text);
    if (amount !== null && (!Number.isFinite(amount) || amount > VALUE_MAX)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const current = deal.value === null ? null : Number(deal.value);
    if (amount !== current) onSave({ value: amount });
  }

  return (
    <>
      <div className="flex gap-2">
        <Input
          id="deal-value"
          value={text}
          inputMode="decimal"
          placeholder="0"
          disabled={!canEdit}
          aria-invalid={invalid || undefined}
          className="min-w-0 flex-1 text-sm tabular-nums mouse:min-h-9"
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={editKeys(text !== stored, () => setText(stored))}
        />
        <Select
          value={deal.currency}
          items={currencies}
          disabled={!canEdit}
          onValueChange={(next) =>
            next && next !== deal.currency && onSave({ currency: next as DealPatch["currency"] })
          }
        >
          <SelectTrigger
            aria-label={t("form.currency")}
            className="w-24 shrink-0 text-sm mouse:min-h-9"
          >
            <span className="truncate">{deal.currency}</span>
          </SelectTrigger>
          <SelectContent>
            {currencies.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {invalid && <p className="text-xs text-pink">{t("errors.valueInvalid")}</p>}
    </>
  );
}

/** Exactly one person looks after the deal: the owner or an active worker of the space. */
function AssigneeField({
  deal,
  canEdit,
  onSave,
}: {
  deal: Deal;
  canEdit: boolean;
  onSave: (change: DealPatch) => void;
}) {
  const assignees = useAssignees();
  const nameOf = useAssigneeName();
  const value = deal.assignee_id ?? "";
  const items = useMemo(() => {
    const list = (assignees.data ?? []).map((person) => ({
      value: person.userId,
      label: nameOf(person.userId),
    }));
    // Whoever has it stays offered, even after leaving the space.
    if (value && !list.some((item) => item.value === value)) {
      list.push({ value, label: nameOf(value) });
    }
    return list;
  }, [assignees.data, nameOf, value]);

  return (
    <Select
      value={value}
      items={items}
      disabled={!canEdit}
      onValueChange={(next) => next && next !== deal.assignee_id && onSave({ assignee_id: next })}
    >
      <SelectTrigger id="deal-assignee" className="text-sm mouse:min-h-9">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={nameOf(deal.assignee_id)} className="size-5 text-[9px]" />
          <span className="truncate">{nameOf(deal.assignee_id)}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The deal's own free-text note (saved on leaving the field), the reason of a
 * loss, and the notes from Notes tied to it or mentioning it.
 */
function DealNotes({
  deal,
  canEdit,
  onSave,
  onClose,
}: {
  deal: Deal;
  canEdit: boolean;
  onSave: (change: DealPatch) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.detail");
  const [text, setText] = useSyncedText(deal.description ?? "");
  const [reason, setReason] = useSyncedText(deal.lost_reason ?? "");

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label htmlFor="deal-description" className="micro-label">
          {t("notes")}
        </label>
        {canEdit ? (
          <Textarea
            id="deal-description"
            value={text}
            maxLength={DESCRIPTION_MAX}
            placeholder={t("notesPlaceholder")}
            className="min-h-28 text-sm"
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text.trim() !== (deal.description ?? "")) onSave({ description: text.trim() });
            }}
          />
        ) : (
          <p className="text-sm whitespace-pre-line text-ink-soft">{deal.description || "—"}</p>
        )}
      </section>

      {deal.lost_at && (
        <section className="flex flex-col gap-2">
          <label htmlFor="deal-lost-reason" className="micro-label">
            {t("lostReason")}
          </label>
          {canEdit ? (
            <Textarea
              id="deal-lost-reason"
              value={reason}
              maxLength={REASON_MAX}
              className="min-h-20 text-sm"
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => {
                if (reason.trim() !== (deal.lost_reason ?? ""))
                  onSave({ lost_reason: reason.trim() });
              }}
            />
          ) : (
            <p className="text-sm whitespace-pre-line text-ink-soft">{deal.lost_reason || "—"}</p>
          )}
        </section>
      )}

      <WorkNotes
        target={{ kind: "deal", id: deal.id }}
        title={deal.title}
        template={null}
        onOpenNote={onClose}
      />
      <MentionedInNotes kind="deal" id={deal.id} onOpenNote={onClose} />
    </div>
  );
}

/** Invoice, e-mail to the primary contact, and deleting the deal. */
function DealActions({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const t = useTranslations("pipeline.detail");
  const router = useRouter();
  const errorText = useInvoiceErrorText();
  const remove = useDeleteDeal();
  const invoice = useCreateInvoiceFromDeal();
  const canEdit = useCan("pipeline", "edit");
  const canInvoice = useCan("finance", "edit");
  const canEmail = useCanContacts("edit") && canEdit;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [composing, setComposing] = useState(false);
  const [justSent, setJustSent] = useState<{ subject: string; body: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const tables = useContactTables().data ?? [];
  // Neither hook is skipped when the deal has no contact (rules of hooks); a nil
  // id keeps the query well-formed while matching nothing.
  const contactEntry = useContactEntry(deal.contact?.id ?? NIL_CONTACT_ID).data;
  const contactEmail = useContact(deal.contact?.id ?? NIL_CONTACT_ID).data?.email ?? null;

  if (!canInvoice && !canEmail && !canEdit) return null;

  async function confirmDelete() {
    try {
      await remove.mutateAsync(deal.id);
      setConfirmingDelete(false);
      onClose();
    } catch {
      /* the dialog shows the error */
    }
  }

  return (
    <section className="flex flex-col gap-2">
      {canInvoice && (
        <Button
          type="button"
          variant="secondary"
          disabled={invoice.isPending}
          onClick={() =>
            invoice.mutate(deal.id, { onSuccess: (id) => router.push(invoicePath(id)) })
          }
        >
          <FileTextIcon aria-hidden data-icon="inline-start" />
          {t("createInvoice")}
        </Button>
      )}
      {invoice.isError && (
        <FormAlert>
          {t("invoiceFailed")} {errorText(invoice.error)}
        </FormAlert>
      )}

      {canEmail && (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={!contactEmail}
            onClick={() => setComposing(true)}
          >
            <MailIcon aria-hidden data-icon="inline-start" />
            {t("writeEmail")}
          </Button>
          {!contactEmail && (
            <p className="text-xs text-ink-muted">
              {deal.contact ? t("emailNeedsAddress") : t("emailNeedsContact")}
            </p>
          )}
        </>
      )}

      {justSent && (
        <FormAlert tone="success" className="flex flex-col gap-3">
          <span>{t("emailSent")}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setMoving(true)}>
              {t("moveToEmailSent")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJustSent(null)}>
              {t("dismissEmailSent")}
            </Button>
          </div>
        </FormAlert>
      )}

      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          className="mt-2 self-start text-pink hover:text-pink"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2Icon aria-hidden data-icon="inline-start" />
          {t("delete")}
        </Button>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("deleteTitle")}
        description={t("deleteDescription", { title: deal.title })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />

      {deal.contact && (
        <>
          <ComposeEmailDialog
            open={composing}
            onOpenChange={setComposing}
            contactId={deal.contact.id}
            contactEmail={contactEmail}
            dealId={deal.id}
            defaultSubject={deal.title}
            onSent={setJustSent}
          />
          <MoveContactDialog
            open={moving}
            onOpenChange={(next) => {
              setMoving(next);
              if (!next) setJustSent(null);
            }}
            contactId={deal.contact.id}
            currentTableId={contactEntry?.table_id ?? null}
            tables={tables}
            targetSystemKey="email_sent"
            prefillBySystemKey={
              justSent ? { email_body: emailSummary(justSent.subject, justSent.body) } : undefined
            }
            onMoved={() => {
              setMoving(false);
              setJustSent(null);
            }}
          />
        </>
      )}
    </section>
  );
}
