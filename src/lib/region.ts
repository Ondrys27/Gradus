import type { DateFormat, NumberFormatKey, TimeFormat, WeekStart } from "./format";
import { TIMEZONE_COUNTRIES } from "./timezone-countries";

export const DEFAULT_TIME_ZONE = "Europe/Prague";
export const DEFAULT_COUNTRY = "CZ";

/** Every country that has a time zone, as ISO 3166-1 alpha-2 codes. */
export const COUNTRY_CODES: string[] = [...new Set(Object.values(TIMEZONE_COUNTRIES))].sort();

export function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones the runtime knows, falling back to our own table. */
export function listTimeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.length > 0 ? supported : Object.keys(TIMEZONE_COUNTRIES).sort();
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Country a time zone belongs to, or `null` for zones like UTC. */
export function countryFromTimeZone(timeZone: string): string | null {
  return TIMEZONE_COUNTRIES[timeZone] ?? null;
}

export type RegionFormats = {
  currency: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormatKey;
  weekStartsOn: WeekStart;
};

const EUROZONE = [
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
];

const CZECH: RegionFormats = {
  currency: "CZK",
  dateFormat: "d. M. yyyy",
  timeFormat: "HH:mm",
  numberFormat: "cs",
  weekStartsOn: 1,
};
const EURO_DOTS: RegionFormats = {
  currency: "EUR",
  dateFormat: "dd.MM.yyyy",
  timeFormat: "HH:mm",
  numberFormat: "de",
  weekStartsOn: 1,
};
const EURO_SPACES: RegionFormats = {
  currency: "EUR",
  dateFormat: "dd/MM/yyyy",
  timeFormat: "HH:mm",
  numberFormat: "fr",
  weekStartsOn: 1,
};

const PRESETS: Record<string, RegionFormats> = {
  CZ: CZECH,
  SK: { ...CZECH, currency: "EUR" },
  DE: EURO_DOTS,
  AT: EURO_DOTS,
  NL: EURO_DOTS,
  FR: EURO_SPACES,
  BE: EURO_SPACES,
  ES: { ...EURO_DOTS, dateFormat: "dd/MM/yyyy" },
  IT: { ...EURO_DOTS, dateFormat: "dd/MM/yyyy" },
  PL: {
    currency: "PLN",
    dateFormat: "dd.MM.yyyy",
    timeFormat: "HH:mm",
    numberFormat: "cs",
    weekStartsOn: 1,
  },
  HU: {
    currency: "HUF",
    dateFormat: "yyyy-MM-dd",
    timeFormat: "HH:mm",
    numberFormat: "cs",
    weekStartsOn: 1,
  },
  CH: {
    currency: "CHF",
    dateFormat: "dd.MM.yyyy",
    timeFormat: "HH:mm",
    numberFormat: "ch",
    weekStartsOn: 1,
  },
  GB: {
    currency: "GBP",
    dateFormat: "dd/MM/yyyy",
    timeFormat: "HH:mm",
    numberFormat: "en",
    weekStartsOn: 1,
  },
  IE: {
    currency: "EUR",
    dateFormat: "dd/MM/yyyy",
    timeFormat: "HH:mm",
    numberFormat: "en",
    weekStartsOn: 1,
  },
  US: {
    currency: "USD",
    dateFormat: "MM/dd/yyyy",
    timeFormat: "h:mm a",
    numberFormat: "en",
    weekStartsOn: 0,
  },
  CA: {
    currency: "CAD",
    dateFormat: "yyyy-MM-dd",
    timeFormat: "h:mm a",
    numberFormat: "en",
    weekStartsOn: 0,
  },
  AU: {
    currency: "AUD",
    dateFormat: "dd/MM/yyyy",
    timeFormat: "h:mm a",
    numberFormat: "en",
    weekStartsOn: 1,
  },
  SE: {
    currency: "SEK",
    dateFormat: "yyyy-MM-dd",
    timeFormat: "HH:mm",
    numberFormat: "fr",
    weekStartsOn: 1,
  },
  UA: {
    currency: "UAH",
    dateFormat: "dd.MM.yyyy",
    timeFormat: "HH:mm",
    numberFormat: "fr",
    weekStartsOn: 1,
  },
};

/**
 * Sensible starting formats for a new account in a country. Used once at
 * registration; afterwards the user's own choices in settings win.
 */
export function regionFormats(country: string | null): RegionFormats {
  if (!country) return CZECH;
  if (PRESETS[country]) return PRESETS[country];
  if (EUROZONE.includes(country)) return EURO_DOTS;
  return {
    currency: "USD",
    dateFormat: "dd/MM/yyyy",
    timeFormat: "HH:mm",
    numberFormat: "en",
    weekStartsOn: 1,
  };
}
