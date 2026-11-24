"use client";

import { decimalMarkOf, parseAmountInput } from "@/features/finance/plan/amount-input";
import { useFormatSettings } from "@/lib/use-format-settings";

/** "1 500,50" in the user's number format; an empty field is null, a wrong one NaN. */
export function useAmountText() {
  const settings = useFormatSettings();
  const mark = decimalMarkOf(settings.numberLocale);
  return {
    parse: (text: string): number | null => {
      if (text.trim() === "") return null;
      const parsed = parseAmountInput(text, mark);
      return parsed.ok ? parsed.value : Number.NaN;
    },
    show: (value: number | null | undefined) =>
      value === null || value === undefined ? "" : String(value).replace(".", mark),
  };
}
