"use client";

import { useState, type ReactNode } from "react";
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
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone, telHref } from "@/lib/phone";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useUserSettings } from "@/features/account/queries";
import { stageTone } from "@/features/pipeline/types";
import { ComposeEmailDialog } from "@/features/email/compose-email-dialog";
import { emailSummary } from "@/features/email/types";
import { ActivityPanel } from "./activity-panel";
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
      href="/contacts"
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
  const canEdit = useCan("contacts", "edit");
  const entry = useContactEntry(contact.id).data;
  const tables = useContactTables().data ?? [];
  const name = contactName(contact);
  const person = contactPerson(contact);

  async function confirmDelete() {
    try {
      await remove.mutateAsync();
      router.replace("/contacts");
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
          <NotesCard contact={contact} readOnly={!canEdit} />
          <DealsCard contactId={contact.id} />
          {canEdit && (
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

function DealsCard({ contactId }: { contactId: string }) {
  const t = useTranslations("contacts.deals");
  const settings = useFormatSettings();
  const deals = useContactDeals(contactId);

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="micro-label">{t("title")}</h2>
        <Link href="/pipeline" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("openPipeline")}
        </Link>
      </div>
      {deals.isPending ? (
        <Skeleton className="h-12 rounded-xl" />
      ) : deals.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : deals.data.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {deals.data.map((deal) => (
            <li
              key={deal.id}
              className="flex items-center gap-3 border-b border-line/60 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{deal.title}</span>
              {deal.value !== null && (
                <span className="text-sm text-ink-soft tabular-nums">
                  {formatCurrency(Number(deal.value), deal.currency, settings)}
                </span>
              )}
              {deal.stage && (
                <StatusPill tone={stageTone(deal.stage.color)}>{deal.stage.name}</StatusPill>
              )}
            </li>
          ))}
        </ul>
      )}
    </GlowCard>
  );
}
