import { DEFAULT_FORMAT_SETTINGS, formatNumber, type FormatSettings } from "@/lib/format";
import { METRICS_TIMEZONE, type MetricUnit } from "@/lib/analytics/metrics";

/** A translator of the `admin.units` namespace. */
export type UnitTranslate = (key: string, values?: Record<string, string | number>) => string;

/** Formats of the administration: the defaults, days cut in the metrics zone. */
export const ADMIN_FORMAT_SETTINGS: FormatSettings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: METRICS_TIMEZONE,
};

/** Whole numbers stay whole; averages below 100 keep one decimal. */
function decimalsFor(value: number): number {
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
    case "czk":
      return formatNumber(
        value,
        {
          style: "currency",
          currency: unit === "usd" ? "USD" : "CZK",
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

/** A change in percent with its sign, e.g. "+12,5 %". */
export function formatChange(
  change: number,
  settings: FormatSettings = ADMIN_FORMAT_SETTINGS,
): string {
  return formatNumber(change / 100, { style: "percent", decimals: 1, signed: true }, settings);
}
