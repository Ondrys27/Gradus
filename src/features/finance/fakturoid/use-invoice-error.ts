"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { errorCodeOf } from "./errors";

/** A sentence for a failed invoice or Fakturoid action, with Fakturoid's own reason when given. */
export function useInvoiceErrorText() {
  const t = useTranslations("finance.fakturoid");
  return useCallback(
    (error: unknown) => {
      const { code, detail } = errorCodeOf(error);
      const text = t(`errors.${code}`);
      return detail ? `${text} ${t("detail", { detail })}` : text;
    },
    [t],
  );
}
