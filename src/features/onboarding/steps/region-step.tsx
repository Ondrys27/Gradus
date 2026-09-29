import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateSettings, useUserSettings } from "@/features/account/queries";
import { CURRENCIES, countryName, currencyName } from "@/lib/format";
import { browserTimeZone, COUNTRY_CODES, countryFromTimeZone } from "@/lib/region";
import { StepShell } from "../step-shell";

export function RegionStep({ onNext }: { onNext: () => void }) {
  const t = useTranslations("onboarding.region");
  const tActions = useTranslations("onboarding.actions");
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const update = useUpdateSettings();

  const [country, setCountry] = useState(settings.country_code);
  const [currency, setCurrency] = useState(settings.currency);

  // Detected once, after mount: the server does not know the browser's zone.
  useEffect(() => {
    const zone = browserTimeZone();
    const detected = countryFromTimeZone(zone);
    if (detected) setCountry((current) => (current === settings.country_code ? detected : current));
    // Only ever applied once, right after the step appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countryOptions = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, uiLocale) })).sort(
        (a, b) => a.label.localeCompare(b.label, uiLocale),
      ),
    [uiLocale],
  );
  const currencyOptions = useMemo(
    () =>
      CURRENCIES.map((code) => ({
        value: code,
        label: `${code} — ${currencyName(code, uiLocale)}`,
      })),
    [uiLocale],
  );

  function next() {
    if (country !== settings.country_code || currency !== settings.currency) {
      update.mutate({ country_code: country, currency });
    }
    onNext();
  }

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      footer={
        <Button type="button" size="lg" onClick={next} className="w-full sm:w-auto">
          {tActions("next")}
        </Button>
      }
    >
      <FormField id="onboarding-country" label={t("country")}>
        <Select
          value={country}
          items={countryOptions}
          onValueChange={(value) => typeof value === "string" && setCountry(value)}
        >
          <SelectTrigger id="onboarding-country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[min(var(--available-height),320px)]">
            {countryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField id="onboarding-currency" label={t("currency")}>
        <Select
          value={currency}
          items={currencyOptions}
          onValueChange={(value) => typeof value === "string" && setCurrency(value)}
        >
          <SelectTrigger id="onboarding-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[min(var(--available-height),320px)]">
            {currencyOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </StepShell>
  );
}
