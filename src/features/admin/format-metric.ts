import {
  DEFAULT_FORMAT_SETTINGS,
  formatCsvDecimal,
  formatNumber,
  formatUsd,
  type FormatSettings,
} from "@/lib/format";
import { METRICS_TIMEZONE, type MetricUnit } from "@/lib/analytics/metrics";

/** A translator of the `admin.units` namespace. */
export type UnitTranslate = (key: string, values?: Record<string, string | number>) => string;

/** Formats of the administration: the defaults, days cut in the metrics zone. */
export const ADMIN_FORMAT_SETTINGS: FormatSettings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: METRICS_TIMEZONE,
};

/**
 * Decimals of a metric value. US dollars (AI, Google and e-mail costs) always
 * have two: "0,00 USD", never "0" or "1,2". Otherwise whole numbers stay
 * whole and averages below 100 keep one decimal.
 */
export function decimalsFor(value: number, unit?: MetricUnit): number {
  if (unit === "usd") return 2;
  return Number.isInteger(value) || Math.abs(value) >= 100 ? 0 : 1;
}

/**
 * One value of a metric as text, by its unit. Percent is stored 0–100, ratio
 * 0–1; money stays in its own currency.
 */
export function formatMetricValue(
  value: number | null,
  unit: MetricUnit,
  t: UnitTranslate,
  settings: FormatSettings = ADMIN_FORMAT_SETTINGS,
): string {
  if (value === null || !Number.isFinite(value)) return t("none");
  switch (unit) {
    case "percent":
      return formatNumber(value / 100, { style: "percent", decimals: 1 }, settings);
    case "ratio":
      return formatNumber(value, { style: "percent", decimals: 1 }, settings);
    case "usd":
      return formatUsd(value, settings);
    case "czk":
      return formatNumber(
        value,
        {
          style: "currency",
          currency: "CZK",
          decimals: Math.abs(value) < 10 && value !== 0 ? 2 : 0,
        },
        settings,
      );
    case "minutes":
    case "hours":
    case "days":
    case "ms":
    case "kb":
      return t(unit, { value: formatNumber(value, { decimals: decimalsFor(value) }, settings) });
    default:
      return formatNumber(value, { decimals: decimalsFor(value) }, settings);
  }
}

/**
 * One value of a metric for a CSV export: a plain number, except US dollars,
 * which keep their two decimals ("1.20") like on screen.
 */
export function metricCsvValue(value: number | null, unit: MetricUnit): string | number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return unit === "usd" ? formatCsvDecimal(value, decimalsFor(value, unit)) : value;
}

/** A change in percent with its sign, e.g. "+12,5 %". */
export function formatChange(
  change: number,
  settings: FormatSettings = ADMIN_FORMAT_SETTINGS,
): string {
  return formatNumber(change / 100, { style: "percent", decimals: 1, signed: true }, settings);
}
