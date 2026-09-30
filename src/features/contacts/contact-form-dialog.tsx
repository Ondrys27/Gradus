"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useUserSettings } from "@/features/account/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatPhone, toE164 } from "@/lib/phone";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useCreateContact, useDuplicates, useUpdateContact } from "./queries";
import {
  ADDRESS_MAX,
  CITY_MAX,
  contactSchema,
  EMAIL_MAX,
  fieldErrors,
  NAME_MAX,
  PHONE_MAX,
  WEBSITE_MAX,
  type ContactDraft,
  type ContactErrorKey,
} from "./schemas";
import { contactName, type Contact } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this contact; creating a new one when absent. */
  contact?: Contact;
  onCreated?: (contact: Contact) => void;
  /** Values a new contact starts with, e.g. what was typed into the search. */
  initial?: Partial<ContactDraft>;
};

export function ContactFormDialog({ open, onOpenChange, contact, onCreated, initial }: Props) {
  const t = useTranslations("contacts.form");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={contact ? t("editTitle") : t("createTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      <ContactFields
        key={generation}
        contact={contact}
        initial={initial}
        onDone={() => onOpenChange(false)}
        onCreated={onCreated}
      />
    </ResponsiveDialog>
  );
}

function draftOf(contact?: Contact): ContactDraft {
  return {
    company_name: contact?.company_name ?? "",
    first_name: contact?.first_name ?? "",
    last_name: contact?.last_name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    website: contact?.website ?? "",
    address: contact?.address ?? "",
    city: contact?.city ?? "",
  };
}

const FIELDS: { name: keyof ContactDraft; max: number; type?: string; autoComplete: string }[] = [
  { name: "company_name", max: NAME_MAX, autoComplete: "organization" },
  { name: "first_name", max: NAME_MAX, autoComplete: "given-name" },
  { name: "last_name", max: NAME_MAX, autoComplete: "family-name" },
  { name: "phone", max: PHONE_MAX, type: "tel", autoComplete: "tel" },
  { name: "email", max: EMAIL_MAX, type: "email", autoComplete: "email" },
  { name: "website", max: WEBSITE_MAX, type: "url", autoComplete: "url" },
  { name: "address", max: ADDRESS_MAX, autoComplete: "street-address" },
  { name: "city", max: CITY_MAX, autoComplete: "address-level2" },
];

function ContactFields({
  contact,
  initial,
  onDone,
  onCreated,
}: {
  contact?: Contact;
  initial?: Partial<ContactDraft>;
  onDone: () => void;
  onCreated?: (contact: Contact) => void;
}) {
  const t = useTranslations("contacts");
  const country = useUserSettings().country_code;
  const create = useCreateContact();
  const update = useUpdateContact(contact?.id ?? "");
  const [draft, setDraft] = useState<ContactDraft>(() => {
    if (contact || !initial) return draftOf(contact);
    // A number typed into the search is saved like any other: E.164.
    const phone = initial.phone === undefined ? {} : { phone: toE164(initial.phone, country) ?? "" };
    return { ...draftOf(), ...initial, ...phone };
  });
  const [errors, setErrors] = useState<Partial<Record<string, ContactErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  const phone = useDebouncedValue(draft.phone, 400);
  const email = useDebouncedValue(draft.email, 400);
  const duplicates = useDuplicates(phone, email, contact?.id).data ?? [];
  const pending = create.isPending || update.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = contactSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      if (contact) {
        await update.mutateAsync(parsed.data);
        onDone();
      } else {
        const created = await create.mutateAsync(parsed.data);
        onDone();
        onCreated?.(created);
      }
    } catch {
      setFailed(true);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{t("form.nameHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `contact-${field.name}`;
          const error = errors[field.name] && t(`errors.${errors[field.name]}`);
          return (
            <FormField
              key={field.name}
              id={id}
              label={t(`fields.${field.name}`)}
              error={error}
              className={field.name === "company_name" ? "sm:col-span-2" : undefined}
            >
              {field.name === "phone" ? (
                <PhoneInput
                  {...fieldA11y(id, error)}
                  country={country}
                  value={draft.phone}
                  onChange={(phone) => setDraft((current) => ({ ...current, phone }))}
                />
              ) : (
                <Input
                  {...fieldA11y(id, error)}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  autoFocus={field.name === "company_name"}
                  value={draft[field.name]}
                  maxLength={field.max + 10}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              )}
            </FormField>
          );
        })}
      </div>

      {duplicates.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-gold">
            <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
            {t("form.duplicateTitle", { count: duplicates.length })}
          </p>
          <ul className="flex flex-col gap-1">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                <Link
                  href={`/contacts/${duplicate.id}`}
                  className="inline-flex min-h-11 items-center gap-2 text-ink underline-offset-4 hover:underline mouse:min-h-0"
                >
                  {contactName(duplicate)}
                  <span className="text-ink-muted">
                    {[duplicate.phone && formatPhone(duplicate.phone, country), duplicate.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-ink-soft">{t("form.duplicateHint")}</p>
        </div>
      )}

      {failed && <FormAlert>{t("form.saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {contact ? t("form.save") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
