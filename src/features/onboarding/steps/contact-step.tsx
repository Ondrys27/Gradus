import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { useUserSettings } from "@/features/account/queries";
import { useCreateContact } from "@/features/contacts/queries";
import {
  contactSchema,
  EMAIL_MAX,
  fieldErrors,
  NAME_MAX,
  type ContactDraft,
  type ContactErrorKey,
} from "@/features/contacts/schemas";
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

export function ContactStep({ onNext }: { onNext: () => void }) {
  const t = useTranslations("onboarding.contact");
  const tContacts = useTranslations("contacts");
  const tActions = useTranslations("onboarding.actions");
  const country = useUserSettings().country_code;
  const create = useCreateContact();
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
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
    try {
      await create.mutateAsync(parsed.data);
      onNext();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onNext}
            className="w-full sm:w-auto"
          >
            {tActions("skip")}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={create.isPending}
            onClick={add}
            className="w-full sm:w-auto"
          >
            {create.isPending ? tActions("saving") : tActions("addContact")}
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
