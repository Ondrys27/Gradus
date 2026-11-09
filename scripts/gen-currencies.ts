/**
 * Generates src/config/currencies.ts: every currency in circulation (ISO 4217,
 * as the runtime's Intl knows it) with its decimals and its name in the
 * languages of the app, and the currency of every country.
 *
 *   bun run gen:currencies
 *
 * The runtime's Intl.supportedValuesOf("currency") also lists withdrawn codes
 * (HRK, BGN since Bulgaria joined the euro, ANG, ZWL…), funds and metals, so
 * it is crossed with ACTIVE below. Decimals are the ones money is written with
 * (CLDR), not always the ISO minor unit: HUF, IDR, COP, PKR… are shown whole.
 * Run it again when ACTIVE, COUNTRY_CURRENCY or the app's languages change.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

/** ISO 4217 currencies in circulation (no funds, metals or SDR). */
const ACTIVE = `
AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN
BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB
EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR
ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD
MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR
PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE
SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU
UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
`
  .trim()
  .split(/\s+/);

/**
 * Where the written decimals differ from what Intl reports as the ISO minor
 * unit (CLDR "digits"): these are written as whole amounts.
 */
const DISPLAY_DIGITS: Record<string, number> = {
  AFN: 0,
  ALL: 0,
  COP: 0,
  HUF: 0,
  IDR: 0,
  IQD: 0,
  IRR: 0,
  KPW: 0,
  LAK: 0,
  LBP: 0,
  MGA: 0,
  MMK: 0,
  PKR: 0,
  SOS: 0,
  SYP: 0,
  YER: 0,
};

/** The currency of each country (ISO 3166-1 alpha-2), as on 1 January 2026. */
const COUNTRY_CURRENCY: Record<string, string> = {
  AD: "EUR", AE: "AED", AF: "AFN", AG: "XCD", AI: "XCD", AL: "ALL", AM: "AMD", AO: "AOA",
  AR: "ARS", AS: "USD", AT: "EUR", AU: "AUD", AW: "AWG", AX: "EUR", AZ: "AZN", BA: "BAM",
  BB: "BBD", BD: "BDT", BE: "EUR", BF: "XOF", BG: "EUR", BH: "BHD", BI: "BIF", BJ: "XOF",
  BL: "EUR", BM: "BMD", BN: "BND", BO: "BOB", BQ: "USD", BR: "BRL", BS: "BSD", BT: "BTN",
  BV: "NOK", BW: "BWP", BY: "BYN", BZ: "BZD", CA: "CAD", CC: "AUD", CD: "CDF", CF: "XAF",
  CG: "XAF", CH: "CHF", CI: "XOF", CK: "NZD", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP",
  CR: "CRC", CU: "CUP", CV: "CVE", CW: "XCG", CX: "AUD", CY: "EUR", CZ: "CZK", DE: "EUR",
  DJ: "DJF", DK: "DKK", DM: "XCD", DO: "DOP", DZ: "DZD", EC: "USD", EE: "EUR", EG: "EGP",
  EH: "MAD", ER: "ERN", ES: "EUR", ET: "ETB", FI: "EUR", FJ: "FJD", FK: "FKP", FM: "USD",
  FO: "DKK", FR: "EUR", GA: "XAF", GB: "GBP", GD: "XCD", GE: "GEL", GF: "EUR", GG: "GBP",
  GH: "GHS", GI: "GIP", GL: "DKK", GM: "GMD", GN: "GNF", GP: "EUR", GQ: "XAF", GR: "EUR",
  GS: "GBP", GT: "GTQ", GU: "USD", GW: "XOF", GY: "GYD", HK: "HKD", HM: "AUD", HN: "HNL",
  HR: "EUR", HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR", IL: "ILS", IM: "GBP", IN: "INR",
  IO: "USD", IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JE: "GBP", JM: "JMD", JO: "JOD",
  JP: "JPY", KE: "KES", KG: "KGS", KH: "KHR", KI: "AUD", KM: "KMF", KN: "XCD", KP: "KPW",
  KR: "KRW", KW: "KWD", KY: "KYD", KZ: "KZT", LA: "LAK", LB: "LBP", LC: "XCD", LI: "CHF",
  LK: "LKR", LR: "LRD", LS: "LSL", LT: "EUR", LU: "EUR", LV: "EUR", LY: "LYD", MA: "MAD",
  MC: "EUR", MD: "MDL", ME: "EUR", MF: "EUR", MG: "MGA", MH: "USD", MK: "MKD", ML: "XOF",
  MM: "MMK", MN: "MNT", MO: "MOP", MP: "USD", MQ: "EUR", MR: "MRU", MS: "XCD", MT: "EUR",
  MU: "MUR", MV: "MVR", MW: "MWK", MX: "MXN", MY: "MYR", MZ: "MZN", NA: "NAD", NC: "XPF",
  NE: "XOF", NF: "AUD", NG: "NGN", NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR", NR: "AUD",
  NU: "NZD", NZ: "NZD", OM: "OMR", PA: "PAB", PE: "PEN", PF: "XPF", PG: "PGK", PH: "PHP",
  PK: "PKR", PL: "PLN", PM: "EUR", PN: "NZD", PR: "USD", PS: "ILS", PT: "EUR", PW: "USD",
  PY: "PYG", QA: "QAR", RE: "EUR", RO: "RON", RS: "RSD", RU: "RUB", RW: "RWF", SA: "SAR",
  SB: "SBD", SC: "SCR", SD: "SDG", SE: "SEK", SG: "SGD", SH: "SHP", SI: "EUR", SJ: "NOK",
  SK: "EUR", SL: "SLE", SM: "EUR", SN: "XOF", SO: "SOS", SR: "SRD", SS: "SSP", ST: "STN",
  SV: "USD", SX: "XCG", SY: "SYP", SZ: "SZL", TC: "USD", TD: "XAF", TF: "EUR", TG: "XOF",
  TH: "THB", TJ: "TJS", TK: "NZD", TL: "USD", TM: "TMT", TN: "TND", TO: "TOP", TR: "TRY",
  TT: "TTD", TV: "AUD", TW: "TWD", TZ: "TZS", UA: "UAH", UG: "UGX", UM: "USD", US: "USD",
  UY: "UYU", UZ: "UZS", VA: "EUR", VC: "XCD", VE: "VES", VG: "USD", VI: "USD", VN: "VND",
  VU: "VUV", WF: "XPF", WS: "WST", XK: "EUR", YE: "YER", YT: "EUR", ZA: "ZAR", ZM: "ZMW",
  ZW: "ZWG",
};

const LOCALES = ["cs", "en"] as const;

const supported = new Set(Intl.supportedValuesOf("currency"));
const codes = ACTIVE.filter((code) => supported.has(code)).sort();
const missing = ACTIVE.filter((code) => !supported.has(code));
if (missing.length) console.warn(`Not known to this runtime, left out: ${missing.join(" ")}`);

const names = Object.fromEntries(
  LOCALES.map((locale) => [locale, new Intl.DisplayNames([locale], { type: "currency" })]),
);
const isoDigits = (code: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
    .maximumFractionDigits ?? 2;

const list = codes.map((code) => ({
  code,
  digits: DISPLAY_DIGITS[code] ?? isoDigits(code),
  name: Object.fromEntries(LOCALES.map((locale) => [locale, names[locale].of(code) ?? code])),
}));

const countries = Object.fromEntries(
  Object.entries(COUNTRY_CURRENCY)
    .filter(([, currency]) => codes.includes(currency))
    .sort(([a], [b]) => a.localeCompare(b)),
);
const dropped = Object.keys(COUNTRY_CURRENCY).filter((country) => !(country in countries));
if (dropped.length) console.warn(`Countries without a known currency, left out: ${dropped.join(" ")}`);

const out = `// Generated by \`bun run gen:currencies\` (scripts/gen-currencies.ts). Do not edit by hand.
//
// Every currency in circulation (ISO 4217) with the decimals money is written
// with and its name in the app's languages (Intl.DisplayNames), and the
// currency of every country. Helpers are in src/lib/currency.ts.

export type CurrencyInfo = {
  code: string;
  /** Decimals an amount is written with: 0 for JPY, HUF, KRW…, 3 for KWD… */
  digits: number;
  name: { cs: string; en: string };
};

export const CURRENCY_LIST: readonly CurrencyInfo[] = [
${list.map((item) => `  ${JSON.stringify(item)},`).join("\n")}
];

/** ISO 3166-1 alpha-2 country → its currency. */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
${Object.entries(countries)
  .map(([country, currency]) => `  ${country}: "${currency}",`)
  .join("\n")}
};
`;

const target = path.join(process.cwd(), "src/config/currencies.ts");
writeFileSync(target, out);
console.log(`${list.length} currencies, ${Object.keys(countries).length} countries → ${target}`);
