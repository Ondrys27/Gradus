"use client";

import { useMemo, useState, type FormEvent } from "react";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/features/account/queries";
import { countryName, CURRENCIES } from "@/lib/format";
import { COUNTRY_CODES } from "@/lib/region";
import { errorCodeOf } from "./errors";
import { czAccountToIban, formatIban } from "./iban";
import { isValidIco } from "./ico";
import { useAresLookup, useSaveInvoiceProfile } from "./queries";
import { fieldErrors, invoiceProfileSchema, type InvoiceProfileInput } from "./schemas";
import { SimpleSelect } from "./simple-select";
import { DEFAULT_ACCENT, type InvoiceProfile } from "./types";

type Values = {
  name: string;
  company_reg_no: string;
  vat_no: string;
  vat_payer: boolean;
  street: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  account_number: string;
  bank_code: string;
  iban: string;
  bic: string;
  due_days: string;
  currency: string;
  number_prefix: string;
  footer_text: string;
};

function initialValues(profile: InvoiceProfile | null, country: string, currency: string): Values {
  return {
    name: profile?.name ?? "",
    company_reg_no: profile?.company_reg_no ?? "",
    vat_no: profile?.vat_no ?? "",
    vat_payer: profile?.vat_payer ?? false,
    street: profile?.street ?? "",
    city: profile?.city ?? "",
    postal_code: profile?.postal_code ?? "",
    country: profile?.country ?? country,
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    account_number: profile?.account_number ?? "",
    bank_code: profile?.bank_code ?? "",
    iban: profile?.iban ?? "",
    bic: profile?.bic ?? "",
    due_days: String(profile?.due_days ?? 14),
    currency: profile?.currency ?? currency,
    number_prefix: profile?.number_prefix ?? "",
    footer_text: profile?.footer_text ?? "",
  };
}

/** What the form keeps of the look; the settings change it separately. */
export function profileInput(values: Values, profile: InvoiceProfile | null, qrDefault: boolean): InvoiceProfileInput {
  return {
    ...values,
    due_days: Number(values.due_days),
    style: profile?.style ?? "clean",
    accent_color: profile?.accent_color ?? DEFAULT_ACCENT,
    qr_enabled: profile?.qr_enabled ?? qrDefault,
  };
}

/** The same input from a saved profile, for changing only its look. */
export function profileToInput(profile: InvoiceProfile): InvoiceProfileInput {
  return {
    ...profile,
    company_reg_no: profile.company_reg_no ?? "",
    vat_no: profile.vat_no ?? "",
    street: profile.street ?? "",
    city: profile.city ?? "",
    postal_code: profile.postal_code ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    account_number: profile.account_number ?? "",
    bank_code: profile.bank_code ?? "",
    iban: profile.iban ?? "",
    bic: profile.bic ?? "",
    footer_text: profile.footer_text ?? "",
  };
}

/**
 * The supplier's details: who issues the invoices, where the money goes and
 * how invoices are numbered. The first time in the "Before your first
 * invoice" guide, afterwards in Settings → Invoices. Czech companies can be
 * filled in from ARES by their company ID.
 */
export function InvoiceProfileForm({
  profile,
  submitLabel,
  onSaved,
}: {
  profile: InvoiceProfile | null;
  submitLabel: string;
  onSaved?: (profile: InvoiceProfile) => void;
}) {
  const t = useTranslations("invoices.profile");
  const tErrors = useTranslations("invoices.fieldErrors");
  const tFailure = useTranslations("finance.invoiceErrors");
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const save = useSaveInvoiceProfile();
  const ares = useAresLookup();
  const [values, setValues] = useState(() =>
    initialValues(profile, settings.country_code || "CZ", settings.currency || "CZK"),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const czech = values.country === "CZ";
  const iban = czech && values.account_number && values.bank_code
    ? czAccountToIban(values.account_number, values.bank_code)
    : null;
  const countryOptions = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, uiLocale) })).sort((a, b) =>
        a.label.localeCompare(b.label, uiLocale),
      ),
    [uiLocale],
  );
  const currencyOptions = useMemo(() => {
    const codes: string[] = [...CURRENCIES];
    if (!codes.includes(values.currency)) codes.push(values.currency);
    return codes.map((code) => ({ value: code, label: code }));
  }, [values.currency]);

  const error = (key: string) => {
    const code = errors[key];
    if (!code) return undefined;
    return tErrors.has(code) ? tErrors(code) : tErrors("invalid");
  };

  async function fillFromAres() {
    try {
      const company = await ares.mutateAsync(values.company_reg_no);
      setValues((current) => ({
        ...current,
        name: company.name,
        company_reg_no: company.companyRegNo,
        vat_no: company.vatNo ?? current.vat_no,
        street: company.street ?? current.street,
        city: company.city ?? current.city,
        postal_code: company.postalCode ?? current.postal_code,
        country: company.country,
      }));
      setErrors({});
    } catch {
      // The message under the button says what happened.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = profileInput(
      { ...values, iban: czech ? "" : values.iban, account_number: czech ? values.account_number : "", bank_code: czech ? values.bank_code : "" },
      profile,
      settings.country_code === "CZ",
    );
    const parsed = invoiceProfileSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    try {
      const result = await save.mutateAsync(input);
      setSaved(true);
      onSaved?.(result);
    } catch {
      // Shown below the form.
    }
  }

  const icoValid = isValidIco(values.company_reg_no);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("who")}</legend>
        <FormField id="invoice-profile-name" label={t("name")} hint={t("nameHint")} error={error("name")}>
          <Input
            id="invoice-profile-name"
            value={values.name}
            autoComplete="organization"
            onChange={(event) => set("name", event.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="invoice-profile-ico"
            label={t("companyRegNo")}
            error={error("company_reg_no")}
            aside={
              czech ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="-mr-2.5 h-auto py-0"
                  disabled={!icoValid || ares.isPending}
                  onClick={() => void fillFromAres()}
                >
                  {ares.isPending ? (
                    <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <DownloadIcon aria-hidden />
                  )}
                  {t("aresFill")}
                </Button>
              ) : undefined
            }
          >
            <Input
              id="invoice-profile-ico"
              value={values.company_reg_no}
              inputMode="numeric"
              onChange={(event) => set("company_reg_no", event.target.value)}
            />
          </FormField>
          <FormField id="invoice-profile-dic" label={t("vatNo")} hint={t("vatNoHint")} error={error("vat_no")}>
            <Input
              id="invoice-profile-dic"
              value={values.vat_no}
              onChange={(event) => set("vat_no", event.target.value.toUpperCase())}
            />
          </FormField>
        </div>
        {ares.isError && (
          <p role="status" className="text-xs text-pink">
            {tFailure(errorCodeOf(ares.error))}
          </p>
        )}
        {ares.isSuccess && !ares.isPending && (
          <p role="status" className="text-xs text-green">
            {t("aresFilled")}
          </p>
        )}
        <label htmlFor="invoice-profile-vat-payer" className="flex min-h-11 items-center justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">{t("vatPayer")}</span>
            <span className="text-xs text-ink-muted">{t("vatPayerHint")}</span>
          </span>
          <Switch
            id="invoice-profile-vat-payer"
            checked={values.vat_payer}
            onCheckedChange={(checked) => set("vat_payer", checked)}
          />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("address")}</legend>
        <FormField id="invoice-profile-street" label={t("street")} error={error("street")}>
          <Input
            id="invoice-profile-street"
            value={values.street}
            autoComplete="street-address"
            onChange={(event) => set("street", event.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <FormField id="invoice-profile-city" label={t("city")} error={error("city")}>
            <Input
              id="invoice-profile-city"
              value={values.city}
              autoComplete="address-level2"
              onChange={(event) => set("city", event.target.value)}
            />
          </FormField>
          <FormField id="invoice-profile-psc" label={t("postalCode")} error={error("postal_code")}>
            <Input
              id="invoice-profile-psc"
              value={values.postal_code}
              autoComplete="postal-code"
              onChange={(event) => set("postal_code", event.target.value)}
            />
          </FormField>
        </div>
        <FormField id="invoice-profile-country" label={t("country")}>
          <SimpleSelect
            id="invoice-profile-country"
            value={values.country}
            options={countryOptions}
            onChange={(value) => set("country", value)}
          />
        </FormField>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("contact")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="invoice-profile-email" label={t("email")} error={error("email")}>
            <Input
              id="invoice-profile-email"
              type="email"
              value={values.email}
              autoComplete="email"
              onChange={(event) => set("email", event.target.value)}
            />
          </FormField>
          <FormField id="invoice-profile-phone" label={t("phone")}>
            <PhoneInput
              id="invoice-profile-phone"
              value={values.phone}
              country={values.country}
              onChange={(value) => set("phone", value)}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("bank")}</legend>
        {czech ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <FormField
                id="invoice-profile-account"
                label={t("accountNumber")}
                hint={t("accountNumberHint")}
                error={error("account_number")}
              >
                <Input
                  id="invoice-profile-account"
                  value={values.account_number}
                  inputMode="numeric"
                  onChange={(event) => set("account_number", event.target.value)}
                />
              </FormField>
              <FormField id="invoice-profile-bank" label={t("bankCode")} error={error("bank_code")}>
                <Input
                  id="invoice-profile-bank"
                  value={values.bank_code}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => set("bank_code", event.target.value)}
                />
              </FormField>
            </div>
            {iban && (
              <p className="text-xs text-ink-muted">{t("ibanComputed", { iban: formatIban(iban) })}</p>
            )}
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField id="invoice-profile-iban" label={t("iban")} error={error("iban")}>
              <Input
                id="invoice-profile-iban"
                value={values.iban}
                onChange={(event) => set("iban", event.target.value.toUpperCase())}
              />
            </FormField>
            <FormField id="invoice-profile-bic" label={t("bic")} error={error("bic")}>
              <Input
                id="invoice-profile-bic"
                value={values.bic}
                onChange={(event) => set("bic", event.target.value.toUpperCase())}
              />
            </FormField>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-ink">{t("invoicing")}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="invoice-profile-due" label={t("dueDays")} error={error("due_days")}>
            <Input
              id="invoice-profile-due"
              value={values.due_days}
              inputMode="numeric"
              onChange={(event) => set("due_days", event.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </FormField>
          <FormField id="invoice-profile-currency" label={t("currency")}>
            <SimpleSelect
              id="invoice-profile-currency"
              value={values.currency}
              options={currencyOptions}
              onChange={(value) => set("currency", value)}
            />
          </FormField>
          <FormField
            id="invoice-profile-prefix"
            label={t("prefix")}
            error={error("number_prefix")}
            hint={t("prefixExample", { number: `${values.number_prefix.trim()}${new Date().getFullYear()}-0001` })}
          >
            <Input
              id="invoice-profile-prefix"
              value={values.number_prefix}
              maxLength={10}
              onChange={(event) => set("number_prefix", event.target.value)}
            />
          </FormField>
        </div>
        <FormField
          id="invoice-profile-footer"
          label={t("footer")}
          hint={values.vat_payer ? t("footerHintVat") : t("footerHint")}
          error={error("footer_text")}
        >
          <Textarea
            id="invoice-profile-footer"
            value={values.footer_text}
            rows={2}
            maxLength={500}
            onChange={(event) => set("footer_text", event.target.value)}
          />
        </FormField>
      </fieldset>

      {save.isError && <FormAlert>{tFailure(errorCodeOf(save.error))}</FormAlert>}
      {Object.keys(errors).length > 0 && <FormAlert>{t("fixErrors")}</FormAlert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {submitLabel}
        </Button>
        {saved && !save.isPending && (
          <span role="status" className="text-sm text-green">
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}
