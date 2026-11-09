import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "@/lib/format";
import type { BookingLocale } from "./page-locale";

/**
 * How dates and times read for a guest (24.4), who has no settings of their
 * own: by the language of the booking page and in the zone they picked. Only
 * for the public page and the guest's e-mails; the host's screens and e-mails
 * use the host's own settings.
 */
const BY_LOCALE: Record<BookingLocale, Omit<FormatSettings, "timeZone" | "currency">> = {
  cs: { numberLocale: "cs-CZ", dateFormat: "d. M. yyyy", timeFormat: "HH:mm", weekStartsOn: 1 },
  en: { numberLocale: "en-GB", dateFormat: "dd/MM/yyyy", timeFormat: "HH:mm", weekStartsOn: 1 },
};

export function guestFormatSettings(locale: BookingLocale, timeZone: string): FormatSettings {
  return { ...DEFAULT_FORMAT_SETTINGS, ...BY_LOCALE[locale], timeZone };
}
