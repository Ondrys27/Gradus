"use client";

import { useTranslations } from "next-intl";
import { formatDate, type FormatSettings } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

/**
 * Under an amount converted at a rate: "roughly at the rate of 9. 11. 2026",
 * and when given, the currency that is actually charged ("charged in EUR").
 */
export function RateNote({
  at,
  charged,
  format,
  className,
}: {
  /** When the rate was fetched (ISO instant). */
  at: string;
  /** The currency of the payment, when it differs from the one shown. */
  charged?: string | null;
  /** Outside the app (the website) the page's formats. */
  format?: FormatSettings;
  className?: string;
}) {
  const t = useTranslations("currency");
  const appFormat = useFormatSettings();
  const date = formatDate(new Date(at), format ?? appFormat);
  return (
    <span className={cn("block text-xs font-normal text-ink-muted", className)} data-testid="rate-note">
      {t("rateNote", { date })}
      {charged ? ` · ${t("chargedIn", { currency: charged })}` : ""}
    </span>
  );
}
