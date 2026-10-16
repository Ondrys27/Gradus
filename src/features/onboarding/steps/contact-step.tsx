import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserSettings } from "@/features/account/queries";
import {
  contactSchema,
  EMAIL_MAX,
  fieldErrors,
  NAME_MAX,
  type ContactDraft,
  type ContactErrorKey,
} from "@/features/contacts/schemas";
import type { Contact } from "@/features/contacts/types";
import { useSaveFirstContact, useWizardContact } from "../queries";
import { StepShell } from "../step-shell";

const EMPTY_DRAFT: ContactDraft = {
  company_name: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  city: "",
};

function draftOf(contact: Contact): ContactDraft {
  return {
    company_name: contact.company_name ?? "",
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    website: contact.website ?? "",
    address: contact.address ?? "",
    city: contact.city ?? "",
  };
}

type StepProps = { onNext: () => void; onBack: () => void };

/**
 * The first contact. Coming back to the step shows the contact the wizard
 * added and saving edits it, so there is never a second one.
 */
export function ContactStep({ onNext, onBack }: StepProps) {
  const t = useTranslations("onboarding.contact");
  const saved = useWizardContact();
  if (saved.isPending) {
    return (
      <StepShell title={t("title")} description={t("description")} onBack={onBack} footer={null}>
        <Skeleton className="h-48 rounded-2xl" />
      </StepShell>
    );
  }
  return (
    <ContactForm
      existing={saved.data ?? null}
      lookupFailed={saved.isError}
      retryLookup={() => void saved.refetch()}
      onNext={onNext}
      onBack={onBack}
    />
  );
}

function ContactForm({
  existing,
  lookupFailed,
  retryLookup,
  onNext,
  onBack,
}: StepProps & {
  existing: Contact | null;
  lookupFailed: boolean;
  retryLookup: () => void;
}) {
  const t = useTranslations("onboarding.contact");
  const tContacts = useTranslations("contacts");
  const tActions = useTranslations("onboarding.actions");
  const country = useUserSettings().country_code;
  const save = useSaveFirstContact();
  const [draft, setDraft] = useState<ContactDraft>(() =>
    existing ? draftOf(existing) : EMPTY_DRAFT,
  );
  const [errors, setErrors] = useState<Partial<Record<string, ContactErrorKey>>>({});
  const [failed, setFailed] = useState(false);

  async function add() {
    setFailed(false);
    const parsed = contactSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    // Without knowing whether a contact is there already, saving could add a second one.
    if (lookupFailed) {
      setFailed(true);
      retryLookup();
      return;
    }
    try {
      await save.mutateAsync({ existingId: existing?.id ?? null, input: parsed.data });
      onNext();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      onBack={onBack}
      backDisabled={save.isPending}
      footer={
        <>
          {/* Once added, the contact is kept or edited; there is nothing left to skip. */}
          {!existing && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={onNext}
              className="w-full sm:w-auto"
            >
              {tActions("skip")}
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            disabled={save.isPending}
            onClick={add}
            className="w-full sm:w-auto"
          >
            {save.isPending
              ? tActions("saving")
              : existing
                ? tActions("next")
                : tActions("addContact")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="onboarding-contact-company"
          label={tContacts("fields.company_name")}
          error={errors.company_name && tContacts(`errors.${errors.company_name}`)}
          className="sm:col-span-2"
        >
          <Input
            {...fieldA11y("onboarding-contact-company", errors.company_name)}
            autoFocus
            autoComplete="organization"
            maxLength={NAME_MAX + 10}
            value={draft.company_name}
            onChange={(event) => setDraft((d) => ({ ...d, company_name: event.target.value }))}
          />
        </FormField>
        <FormField
          id="onboarding-contact-first-name"
          label={tContacts("fields.first_name")}
          error={errors.first_name && tContacts(`errors.${errors.first_name}`)}
        >
          <Input
            {...fieldA11y("onboarding-contact-first-name", errors.first_name)}
            autoComplete="given-name"
            maxLength={NAME_MAX + 10}
            value={draft.first_name}
            onChange={(event) => setDraft((d) => ({ ...d, first_name: event.target.value }))}
          />
        </FormField>
        <FormField
          id="onboarding-contact-phone"
          label={tContacts("fields.phone")}
          error={errors.phone && tContacts(`errors.${errors.phone}`)}
        >
          <PhoneInput
            {...fieldA11y("onboarding-contact-phone", errors.phone)}
            country={country}
            value={draft.phone}
            onChange={(phone) => setDraft((d) => ({ ...d, phone }))}
          />
        </FormField>
        <FormField
          id="onboarding-contact-email"
          label={tContacts("fields.email")}
          error={errors.email && tContacts(`errors.${errors.email}`)}
          className="sm:col-span-2"
        >
          <Input
            {...fieldA11y("onboarding-contact-email", errors.email)}
            type="email"
            autoComplete="email"
            maxLength={EMAIL_MAX + 10}
            value={draft.email}
            onChange={(event) => setDraft((d) => ({ ...d, email: event.target.value }))}
          />
        </FormField>
      </div>
      {failed && <FormAlert>{tContacts("form.saveFailed")}</FormAlert>}
    </StepShell>
  );
}
