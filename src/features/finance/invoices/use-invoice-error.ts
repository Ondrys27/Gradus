"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { errorCodeOf } from "./errors";

/** A sentence for a failed invoice action. */
export function useInvoiceErrorText() {
  const t = useTranslations("finance.invoiceErrors");
  return useCallback((error: unknown) => t(errorCodeOf(error)), [t]);
}
