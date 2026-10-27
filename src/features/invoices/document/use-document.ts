"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useFormatSettings } from "@/lib/use-format-settings";
import { buildInvoiceDocument, type DocText, type DocumentInput, type InvoiceDocument } from "./model";

/** The document for the preview, in the interface language and the user's formats. */
export function useInvoiceDocument(input: DocumentInput | null): InvoiceDocument | null {
  const t = useTranslations("invoices.document");
  const settings = useFormatSettings();
  return useMemo(() => {
    if (!input) return null;
    const text: DocText = (key, values) => t(key as never, values as never);
    return buildInvoiceDocument(input, text, settings);
  }, [input, t, settings]);
}
