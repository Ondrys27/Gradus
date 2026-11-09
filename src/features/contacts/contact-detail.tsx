"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { formatPhone, telHref } from "@/lib/phone";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useUserSettings } from "@/features/account/queries";
import { stageTone } from "@/features/pipeline/types";
import {
  dealOutcome,
  summarizeContactDeals,
  type CurrencyTotal,
} from "@/features/pipeline/contact-deals";
import { NewDealFromContactDialog } from "@/features/pipeline/new-deal-from-contact";
import { useAssigneeName } from "@/features/crm-tasks/use-assignee-name";
import { useMinuteClock } from "@/features/crm-tasks/use-task-dialogs";
import { ComposeEmailDialog } from "@/features/email/compose-email-dialog";
import { emailSummary } from "@/features/email/types";
import { MentionedInNotes } from "@/features/notes/mentioned-in-notes";
import { ActivityPanel } from "./activity-panel";
import { TargetTasks } from "@/features/crm-tasks/target-tasks";
import { ContactFormDialog } from "./contact-form-dialog";
import { byPosition, fieldOptions } from "./field-logic";
import { useCan } from "@/features/account/workspace-queries";
import { MoveContactDialog, type MoveResult } from "./move-contact-dialog";
import {
  useContact,
  useContactDeals,
  useContactEntry,
  useContactTables,
  useDeleteContact,
  useUpdateContact,
} from "./queries";
import { NOTES_MAX, notesSchema, websiteHref } from "./schemas";
import { useFields } from "./table-queries";
import { contactName, contactPerson, tableTone, type Contact, type ContactField } from "./types";

export function ContactDetail({ id }: { id: string }) {
  const t = useTranslations("contacts");
  const contactQuery = useContact(id);

  const backLink = (
    <Link
      href="/app/kontakty"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
    >
      <ArrowLeftIcon aria-hidden data-icon="inline-start" />
      {t("detail.back")}
    </Link>
  );

  if (contactQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </div>
    );
  }

  if (contactQuery.isError || !contactQuery.data) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <EmptyState
          icon={<UsersIcon />}
          title={contactQuery.isError ? t("loadFailed") : t("detail.notFound")}
          action={
            contactQuery.isError && (
              <Button variant="outline" onClick={() => void contactQuery.refetch()}>
                {t("retry")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  return <DetailBody contact={contactQuery.data} backLink={backLink} />;
}

function DetailBody({ contact, backLink }: { contact: Contact; backLink: ReactNode }) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<MoveResult | null>(null);
  const [composing, setComposing] = useState(false);
  const [justSent, setJustSent] = useState<{ subject: string; body: string } | null>(null);
  const [moveEmailPrefill, setMoveEmailPrefill] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const remove = useDeleteContact(contact.id);
  // Changing and moving a contact: contacts "update", or calling it (cold calling).
  const canUpdate = useCan("contacts", "update");
  const canCall = useCan("cold_calling", "call");
  const canEdit = canUpdate || canCall;
  const canDelete = useCan("contacts", "delete");
  // Deals live in the pipeline; without the right to see it the card has nothing to show.
  const canSeeDeals = useCan("pipeline", "view");
  const entry = useContactEntry(contact.id).data;
  const tables = useContactTables().data ?? [];
  const name = contactName(contact);
  const person = contactPerson(contact);

  async function confirmDelete() {
    try {
      await remove.mutateAsync();
      router.replace("/app/kontakty");
    } catch {
      /* the dialog shows the error */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {backLink}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={name} className="size-14 text-lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="page-title truncate">{name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              {person && <span>{person}</span>}
              <CurrentTable contactId={contact.id} />
              {contact.source === "generated" && (
                <StatusPill tone="violet">{t("detail.generated")}</StatusPill>
              )}
              {contact.source === "scheduler" && (
                <StatusPill tone="teal">{t("detail.fromScheduler")}</StatusPill>
              )}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon aria-hidden data-icon="inline-start" />
              {t("detail.edit")}
            </Button>
            <Button
              disabled={tables.length === 0}
              onClick={() => {
                setMoveEmailPrefill(null);
                setMoving(true);
              }}
            >
              <ArrowRightLeftIcon aria-hidden data-icon="inline-start" />
              {t("move.open")}
            </Button>
          </div>
        )}
      </header>

      {moved && (
        <FormAlert tone="success">
          {moved.meetingBooked
            ? t("move.movedWithMeeting", { name: moved.table.name })
            : t("move.moved", { name: moved.table.name })}
        </FormAlert>
      )}

      {justSent && (
        <FormAlert tone="success" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t("detail.emailSent")}</span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMoveEmailPrefill(justSent);
                setMoving(true);
              }}
            >
              {t("detail.moveToEmailSent")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJustSent(null)}>
              {t("detail.dismissEmailSent")}
            </Button>
          </div>
        </FormAlert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-6">
          <ContactInfo
            contact={contact}
            onWriteEmail={canEdit ? () => setComposing(true) : undefined}
          />
          <CurrentTableCard contactId={contact.id} />
          <GlowCard interactive={false}>
            <TargetTasks
              kind="contact"
              id={contact.id}
              target={{
                deal: null,
                contact: {
                  id: contact.id,
                  company_name: contact.company_name,
                  first_name: contact.first_name,
                  last_name: contact.last_name,
                },
              }}
            />
          </GlowCard>
          <NotesCard contact={contact} readOnly={!canEdit} />
          {canSeeDeals && <DealsCard contact={contact} />}
          <MentionedInNotes kind="contact" id={contact.id} card />
          {canDelete && (
            <Button variant="destructive" className="self-start" onClick={() => setDeleting(true)}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("detail.delete")}
            </Button>
          )}
        </div>
        <GlowCard interactive={false}>
          <ActivityPanel contactId={contact.id} />
        </GlowCard>
      </div>

      <ContactFormDialog open={editing} onOpenChange={setEditing} contact={contact} />
      <ComposeEmailDialog
        open={composing}
        onOpenChange={setComposing}
        contactId={contact.id}
        contactEmail={contact.email}
        onSent={setJustSent}
      />
      <MoveContactDialog
        open={moving}
        onOpenChange={(next) => {
          setMoving(next);
          if (!next) setMoveEmailPrefill(null);
        }}
        contactId={contact.id}
        currentTableId={entry?.table_id ?? null}
        tables={tables}
        targetSystemKey={moveEmailPrefill ? "email_sent" : undefined}
        prefillBySystemKey={
          moveEmailPrefill
            ? { email_body: emailSummary(moveEmailPrefill.subject, moveEmailPrefill.body) }
            : undefined
        }
        onMoved={(result) => {
          setMoved(result);
          setJustSent(null);
          setMoveEmailPrefill(null);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("detail.deleteTitle")}
        description={t("detail.deleteDescription", { name })}
        confirmLabel={t("detail.delete")}
        cancelLabel={t("detail.cancel")}
        closeLabel={t("detail.close")}
        pending={remove.isPending}
        error={remove.isError ? t("detail.deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function CurrentTable({ contactId }: { contactId: string }) {
  const t = useTranslations("contacts.detail");
  const settings = useFormatSettings();
  const entry = useContactEntry(contactId).data;
  const table = useContactTables().data?.find((item) => item.id === entry?.table_id);
  if (!entry || !table) return null;
  return (
    <StatusPill
      tone={tableTone(table.color)}
      dot
      title={t("inTableSince", { date: formatDate(new Date(entry.moved_at), settings) })}
    >
      {table.name}
    </StatusPill>
  );
}

/** The answers given when the contact came into its table. */
export function CurrentTableCard({ contactId }: { contactId: string }) {
  const t = useTranslations("contacts");
  const settings = useFormatSettings();
  const entry = useContactEntry(contactId).data;
  const table = useContactTables().data?.find((item) => item.id === entry?.table_id);
  const fields = useFields().data;
  if (!entry || !table || !fields) return null;

  const answers = (entry.answers ?? {}) as Record<string, unknown>;
  const answered = byPosition(fields.filter((field) => field.table_id === table.id)).filter(
    (field) => answers[field.id] !== undefined && answers[field.id] !== null,
  );

  function show(field: ContactField, value: unknown): string {
    if (field.type === "boolean") return value ? t("move.yes") : t("move.no");
    const text = String(value);
    if (field.type === "date") return formatCalendarDate(text, settings);
    if (field.type === "datetime") return formatDateTime(new Date(text), settings);
    if (field.type === "select") {
      return fieldOptions(field.options).find((option) => option.key === text)?.label ?? text;
    }
    return text;
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="micro-label">{t("detail.currentTable")}</h2>
        <StatusPill tone={tableTone(table.color)} dot>
          {table.name}
        </StatusPill>
      </div>
      <p className="text-xs text-ink-muted">
        {t("detail.inTableSince", { date: formatDate(new Date(entry.moved_at), settings) })}
      </p>
      {answered.length > 0 && (
        <dl className="flex flex-col gap-2.5">
          {answered.map((field) => (
            <div key={field.id} className="flex flex-col">
              <dt className="text-xs text-ink-muted">{field.label}</dt>
              <dd className="text-sm whitespace-pre-line text-ink">
                {show(field, answers[field.id])}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </GlowCard>
  );
}

function ContactInfo({
  contact,
  onWriteEmail,
}: {
  contact: Contact;
  /** Absent without the right to edit: sending writes to the contact's history. */
  onWriteEmail?: () => void;
}) {
  const t = useTranslations("contacts");
  const country = useUserSettings().country_code;
  const address = [contact.address, contact.postal_code, contact.city].filter(Boolean).join(", ");
  const name = contactName(contact);
  const hasAny = contact.phone || contact.email || contact.website || address;

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <h2 className="micro-label">{t("detail.info")}</h2>
      {!hasAny && <p className="text-sm text-ink-muted">{t("detail.noInfo")}</p>}
      {contact.phone && (
        <InfoRow
          icon={<PhoneIcon />}
          label={t("fields.phone")}
          value={formatPhone(contact.phone, country)}
        >
          <a
            href={telHref(contact.phone, country)}
            aria-label={t("list.callName", { name })}
            className={buttonVariants({ size: "sm" })}
          >
            <PhoneIcon aria-hidden data-icon="inline-start" />
            {t("detail.call")}
          </a>
        </InfoRow>
      )}
      {contact.email && (
        <InfoRow icon={<MailIcon />} label={t("fields.email")} value={contact.email}>
          {onWriteEmail && (
            <Button
              variant="outline"
              size="sm"
              aria-label={t("list.emailName", { name })}
              onClick={onWriteEmail}
            >
              <MailIcon aria-hidden data-icon="inline-start" />
              {t("detail.write")}
            </Button>
          )}
        </InfoRow>
      )}
      {contact.website && (
        <InfoRow
          icon={<GlobeIcon />}
          label={t("fields.website")}
          value={
            <a
              href={websiteHref(contact.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet underline-offset-4 hover:underline"
            >
              {contact.website}
            </a>
          }
        />
      )}
      {address && <InfoRow icon={<MapPinIcon />} label={t("fields.address")} value={address} />}
    </GlowCard>
  );
}

function InfoRow({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-soft [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="text-sm break-words text-ink">{value}</span>
      </div>
      {children}
    </div>
  );
}

function NotesCard({ contact, readOnly }: { contact: Contact; readOnly: boolean }) {
  const t = useTranslations("contacts.notes");
  const update = useUpdateContact(contact.id);
  const [value, setValue] = useState(contact.notes ?? "");
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const dirty = value !== (contact.notes ?? "");

  async function save() {
    setStatus("idle");
    const parsed = notesSchema.safeParse(value);
    if (!parsed.success) {
      setStatus("failed");
      return;
    }
    try {
      await update.mutateAsync({ notes: parsed.data });
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <label htmlFor="contact-notes" className="micro-label">
        {t("title")}
      </label>
      <Textarea
        id="contact-notes"
        value={value}
        maxLength={NOTES_MAX}
        placeholder={t("placeholder")}
        readOnly={readOnly}
        onChange={(event) => {
          setStatus("idle");
          setValue(event.target.value);
        }}
      />
      {status === "failed" && <FormAlert>{t("saveFailed")}</FormAlert>}
      {!readOnly && (
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm text-green">
            {status === "saved" && !dirty ? t("saved") : ""}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || update.isPending}
            onClick={() => void save()}
          >
            {t("save")}
          </Button>
        </div>
      )}
    </GlowCard>
  );
}

function DealsCard({ contact }: { contact: Contact }) {
  const t = useTranslations("contacts.deals");
  const settings = useFormatSettings();
  const locale = useLocale();
  const now = useMinuteClock();
  const nameOf = useAssigneeName();
  const canCreate = useCan("pipeline", "create");
  const seeAmounts = useCan("pipeline", "see_amounts");
  const deals = useContactDeals(contact.id);
  const [creating, setCreating] = useState(false);
  const summary = useMemo(() => summarizeContactDeals(deals.data ?? []), [deals.data]);
  const money = (totals: CurrencyTotal[]) =>
    totals.length === 0
      ? formatCurrency(0, settings.currency, settings)
      : totals.map((item) => formatCurrency(item.total, item.currency, settings)).join(" + ");

  return (
    <GlowCard
      interactive={false}
      role="region"
      aria-labelledby="contact-deals-title"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="contact-deals-title" className="micro-label">
          {t("title")}
        </h2>
        <div className="flex flex-wrap gap-1">
          <Link href="/app/pipeline" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("openPipeline")}
          </Link>
          {canCreate && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              {t("newDeal")}
            </Button>
          )}
        </div>
      </div>
      {deals.isPending ? (
        <Skeleton className="h-12 rounded-xl" />
      ) : deals.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : deals.data.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <>
          <dl
            className={cn("grid gap-2", seeAmounts ? "grid-cols-3" : "grid-cols-1")}
            aria-label={t("summary.label")}
          >
            <SummaryItem
              label={t("summary.open")}
              value={formatNumber(summary.openCount, {}, settings)}
            />
            {seeAmounts && (
              <>
                <SummaryItem label={t("summary.openValue")} value={money(summary.openValue)} />
                <SummaryItem
                  label={t("summary.won")}
                  value={money(summary.wonValue)}
                  tone="green"
                />
              </>
            )}
          </dl>
          <ul className="flex flex-col">
            {deals.data.map((deal) => {
              const outcome = dealOutcome(deal);
              const details = [
                deal.expected_close_date &&
                  t("closeDate", { date: formatCalendarDate(deal.expected_close_date, settings) }),
                t("assignee", { name: nameOf(deal.assignee_id) }),
                t("lastActivity", {
                  when: formatRelativeTime(new Date(deal.last_activity_at), now, locale),
                }),
              ].filter(Boolean);
              return (
                <li key={deal.id} className="border-b border-line/60 last:border-b-0">
                  <Link
                    href={`/app/pipeline?deal=${deal.id}`}
                    aria-label={t("open", { title: deal.title })}
                    className="flex min-h-14 flex-col gap-1.5 rounded-lg px-1 py-2.5 outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium text-ink">{deal.title}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                        {outcome ? (
                          <StatusPill tone={outcome.kind === "won" ? "green" : "pink"} dot>
                            {t(outcome.kind === "won" ? "wonOn" : "lostOn", {
                              date: formatDate(new Date(outcome.at), settings),
                            })}
                          </StatusPill>
                        ) : (
                          deal.stage && (
                            <StatusPill tone={stageTone(deal.stage.color)} dot>
                              {deal.stage.name}
                            </StatusPill>
                          )
                        )}
                        {details.map((detail) => (
                          <span key={detail as string}>{detail}</span>
                        ))}
                      </span>
                    </span>
                    {seeAmounts && deal.value !== null && (
                      <span className="shrink-0 text-sm text-ink-soft tabular-nums">
                        {formatCurrency(Number(deal.value), deal.currency, settings)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {canCreate && (
        <NewDealFromContactDialog
          open={creating}
          onOpenChange={setCreating}
          contact={{
            id: contact.id,
            company_name: contact.company_name,
            first_name: contact.first_name,
            last_name: contact.last_name,
          }}
          source="contact"
          onCreated={() => undefined}
        />
      )}
    </GlowCard>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-line/60 px-3 py-2">
      <dt className="text-xs break-words text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "text-sm font-semibold break-words tabular-nums",
          tone === "green" ? "text-green" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
