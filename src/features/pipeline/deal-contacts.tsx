"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { PlusIcon, StarIcon, UsersIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { contactHref } from "@/features/crm-tasks/types";
import { cn } from "@/lib/utils";
import { contactLabel } from "./board-logic";
import { ContactPicker } from "./contact-picker";
import {
  useAddDealContact,
  useDealContacts,
  useRemoveDealContact,
  useUpdateDealContact,
} from "./queries";
import { CONTACT_NOTE_MAX, contactNoteSchema } from "./schemas";
import type { DealContact, DealContactLink } from "./types";

type Props = {
  dealId: string;
  canEdit: boolean;
  className?: string;
};

/**
 * The people of a deal: the primary contact first (it is the deal's contact
 * everywhere else), then the others, each with a short role or note. Added
 * from the contacts with a search, or made on the spot from a name.
 */
export function DealContacts({ dealId, canEdit, className }: Props) {
  const t = useTranslations("pipeline.contacts");
  const contacts = useDealContacts(dealId);
  const update = useUpdateDealContact(dealId);
  const remove = useRemoveDealContact(dealId);
  const [adding, setAdding] = useState(false);
  const list = contacts.data ?? [];
  const failed = update.isError || remove.isError;
  const headingId = `deal-contacts-${dealId}`;

  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="micro-label">
          {t("title")}
        </h3>
        {canEdit && !adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
      </div>

      {contacts.isPending ? (
        <Skeleton className="h-14 rounded-xl" />
      ) : contacts.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : list.length === 0 && !adding ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          <UsersIcon aria-hidden className="size-4 shrink-0" />
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((link) => (
            <ContactRow
              key={link.id}
              link={link}
              canEdit={canEdit}
              busy={update.isPending || remove.isPending}
              onNote={(note) => update.mutate({ id: link.id, patch: { note } })}
              onMakePrimary={() => update.mutate({ id: link.id, patch: { is_primary: true } })}
              onRemove={() => remove.mutate({ id: link.id, primary: link.is_primary })}
            />
          ))}
        </ul>
      )}

      {adding && (
        <AddContactForm
          dealId={dealId}
          taken={list.map((link) => link.contact_id)}
          onDone={() => setAdding(false)}
        />
      )}
      {failed && <FormAlert>{t("failed")}</FormAlert>}
    </section>
  );
}

function ContactRow({
  link,
  canEdit,
  busy,
  onNote,
  onMakePrimary,
  onRemove,
}: {
  link: DealContactLink;
  canEdit: boolean;
  busy: boolean;
  onNote: (note: string | null) => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("pipeline.contacts");
  const name = link.contact ? contactLabel(link.contact) : t("hidden");
  return (
    <li className="group flex items-start gap-3 border-b border-line/60 py-2.5 last:border-b-0">
      <Avatar name={name} className="mt-0.5 size-8 text-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {link.contact ? (
            <Link
              href={contactHref(link.contact_id)}
              className="min-w-0 truncate text-sm font-medium text-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {name}
            </Link>
          ) : (
            <span className="truncate text-sm text-ink-muted">{name}</span>
          )}
          {link.is_primary && <StatusPill tone="violet">{t("primary")}</StatusPill>}
        </div>
        <NoteLine note={link.note} name={name} canEdit={canEdit} onSave={onNote} />
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5 mouse:opacity-0 mouse:group-focus-within:opacity-100 mouse:group-hover:opacity-100">
          {!link.is_primary && (
            <IconButton label={t("makePrimary", { name })} disabled={busy} onClick={onMakePrimary}>
              <StarIcon aria-hidden className="size-4" />
            </IconButton>
          )}
          <IconButton label={t("remove", { name })} disabled={busy} onClick={onRemove}>
            <XIcon aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
    </li>
  );
}

/** The role or note under a contact; edited in place, Enter or leaving saves, Esc goes back. */
function NoteLine({
  note,
  name,
  canEdit,
  onSave,
}: {
  note: string | null;
  name: string;
  canEdit: boolean;
  onSave: (note: string | null) => void;
}) {
  const t = useTranslations("pipeline.contacts");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");

  if (!canEdit) {
    return note ? <p className="text-sm break-words text-ink-soft">{note}</p> : null;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(note ?? "");
          setEditing(true);
        }}
        aria-label={t("editNote", { name })}
        className={cn(
          "-mx-1 min-h-8 self-start rounded-md px-1 text-left text-sm break-words outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50",
          note ? "text-ink-soft" : "text-ink-muted",
        )}
      >
        {note || t("addNote")}
      </button>
    );
  }

  function commit() {
    setEditing(false);
    const parsed = contactNoteSchema.safeParse(text);
    if (!parsed.success) return;
    const next = parsed.data || null;
    if (next !== note) onSave(next);
  }

  return (
    <Input
      autoFocus
      value={text}
      maxLength={CONTACT_NOTE_MAX}
      aria-label={t("editNote", { name })}
      placeholder={t("notePlaceholder")}
      className="mt-0.5 text-sm mouse:min-h-9"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          // Esc ends editing here and must not close the deal.
          event.stopPropagation();
          setEditing(false);
        }
      }}
    />
  );
}

function AddContactForm({
  dealId,
  taken,
  onDone,
}: {
  dealId: string;
  taken: string[];
  onDone: () => void;
}) {
  const t = useTranslations("pipeline.contacts");
  const add = useAddDealContact(dealId);
  const [contact, setContact] = useState<DealContact | null>(null);
  const [created, setCreated] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<"already" | "noteTooLong" | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!contact) return;
    if (taken.includes(contact.id)) {
      setError("already");
      return;
    }
    const parsed = contactNoteSchema.safeParse(note);
    if (!parsed.success) {
      setError("noteTooLong");
      return;
    }
    setError(null);
    try {
      await add.mutateAsync({ contactId: contact.id, note: parsed.data, created });
      onDone();
    } catch {
      /* the alert below says so */
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-2xl border border-line p-3"
    >
      <FormField id="deal-contact-new" label={t("pick")}>
        <ContactPicker
          id="deal-contact-new"
          value={contact}
          onChange={(next, isNew) => {
            setContact(next);
            setCreated(Boolean(isNew));
            setError(null);
          }}
        />
      </FormField>
      <FormField
        id="deal-contact-note"
        label={t("note")}
        error={error === "noteTooLong" ? t("noteTooLong") : undefined}
      >
        <Input
          {...fieldA11y(
            "deal-contact-note",
            error === "noteTooLong" ? t("noteTooLong") : undefined,
          )}
          value={note}
          maxLength={CONTACT_NOTE_MAX}
          placeholder={t("notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      {error === "already" && <FormAlert>{t("already")}</FormAlert>}
      {add.isError && <FormAlert>{t("failed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!contact || add.isPending}>
          {t("confirm")}
        </Button>
      </div>
    </form>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 mouse:size-8"
    >
      {children}
    </button>
  );
}
