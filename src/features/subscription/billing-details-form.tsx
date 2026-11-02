"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useUserSettings } from "@/features/account/queries";
import { SimpleSelect } from "@/features/invoices/simple-select";
import { countryName } from "@/lib/format";
import { COUNTRY_CODES } from "@/lib/region";
import { SubscriptionActionError, useBillingDetails, useSaveBillingProfile } from "./queries";
import { billingProfileSchema, type BillingProfile, type BillingProfileInput } from "./schemas";

type Values = Required<{ [K in keyof BillingProfileInput]: string }>;
type FieldKey = keyof Values;

const TEXT_FIELDS: { key: Exclude<FieldKey, "country">; label: string; type?: string; wide?: boolean }[] = [
  { key: "name", label: "name", wide: true },
  { key: "company_reg_no", label: "companyRegNo" },
  { key: "vat_no", label: "vatNo" },
  { key: "street", label: "street", wide: true },
  { key: "city", label: "city" },
  { key: "postal_code", label: "postalCode" },
  { key: "email", label: "email", type: "email", wide: true },
];

function toValues(profile: BillingProfile | null, country: string, email: string | null): Values {
  return {
    name: profile?.name ?? "",
    company_reg_no: profile?.company_reg_no ?? "",
    vat_no: profile?.vat_no ?? "",
    street: profile?.street ?? "",
    city: profile?.city ?? "",
    postal_code: profile?.postal_code ?? "",
    country: profile?.country ?? country,
    email: profile?.email ?? email ?? "",
  };
}

/**
 * Who the receipts are made out to. Until the user saves their own, the
 * supplier's details from invoices fill it in. Editable in a read-only
 * workspace too: paying is how one gets out of it.
 */
export function BillingDetailsForm() {
  const t = useTranslations("subscription.billing");
  const details = useBillingDetails();
  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6" data-testid="subscription-billing">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>
      {details.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : details.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : (
        <Form
          // A saved profile replaces the prefill; start the form from it.
          key={details.data.profile ? "saved" : "prefill"}
          profile={details.data.profile ?? details.data.prefill}
          prefilled={!details.data.profile && details.data.prefill !== null}
        />
      )}
    </GlowCard>
  );
}

function Form({ profile, prefilled }: { profile: BillingProfile | null; prefilled: boolean }) {
  const t = useTranslations("subscription");
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const { user } = useSession();
  const save = useSaveBillingProfile();
  const [values, setValues] = useState<Values>(() =>
    toValues(profile, settings.country_code || "CZ", user.email ?? null),
  );
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const countryOptions = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, uiLocale) })).sort((a, b) =>
        a.label.localeCompare(b.label, uiLocale),
      ),
    [uiLocale],
  );

  const set = (key: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = billingProfileSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<FieldKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(values, {
      onSuccess: () => setSaved(true),
      onError: (error) =>
        setFailure(t(`errors.${error instanceof SubscriptionActionError ? error.code : "unknown"}`)),
    });
  }

  const message = (key: FieldKey) => {
    const code = errors[key];
    return code ? t(`errors.${code}` as "errors.tooLong") : undefined;
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      {prefilled && <p className="text-sm text-teal">{t("billing.prefilled")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((field) => {
          const id = `billing-${field.key}`;
          const error = message(field.key);
          return (
            <FormField
              key={field.key}
              id={id}
              label={t(`billing.${field.label}` as "billing.name")}
              error={error}
              className={field.wide ? "sm:col-span-2" : undefined}
            >
              <Input
                {...fieldA11y(id, error)}
                type={field.type ?? "text"}
                value={values[field.key]}
                autoComplete={field.key === "email" ? "email" : undefined}
                className="h-11 mouse:h-9"
                onChange={(event) => set(field.key, event.target.value)}
              />
            </FormField>
          );
        })}
        <FormField id="billing-country" label={t("billing.country")} error={message("country")}>
          <SimpleSelect
            id="billing-country"
            value={values.country}
            options={countryOptions}
            onChange={(value) => set("country", value)}
          />
        </FormField>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {t("billing.save")}
        </Button>
        {saved && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-green">
            <CheckIcon aria-hidden className="size-4" />
            {t("billing.saved")}
          </p>
        )}
      </div>
    </form>
  );
}
