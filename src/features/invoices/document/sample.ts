import type { InvoiceStyle } from "../types";
import type { DocumentInput } from "./model";

/**
 * A made-up invoice to show the styles with: the thumbnails in Settings →
 * Invoices and the pictures in docs/invoices. Nothing here is real data.
 */
export function sampleInvoice(
  style: InvoiceStyle,
  options: { accent?: string | null; vatPayer?: boolean; locale?: string } = {},
): DocumentInput {
  const vatPayer = options.vatPayer ?? false;
  return {
    kind: "invoice",
    number: "2026-0042",
    issuedOn: "2026-11-02",
    taxableOn: "2026-11-02",
    dueOn: "2026-11-16",
    currency: "CZK",
    supplier: {
      name: "Jana Dvořáková – grafické studio",
      company_reg_no: "25596641",
      vat_no: vatPayer ? "CZ25596641" : undefined,
      vat_payer: vatPayer,
      street: "Křižíkova 148/34",
      city: "Praha 8",
      postal_code: "186 00",
      country: "CZ",
      email: "jana@studio-dvorakova.cz",
      phone: "+420 777 123 456",
      account_number: "19-2000145399",
      bank_code: "0800",
      footer_text: vatPayer
        ? "Zapsáno v živnostenském rejstříku, Úřad městské části Praha 8."
        : "Nejsem plátce DPH. Zapsáno v živnostenském rejstříku, Úřad městské části Praha 8.",
    },
    customer: {
      name: "Pekárna U Zlatého klasu s.r.o.",
      company_reg_no: "00006947",
      vat_no: "CZ00006947",
      street: "Údolní 1207/53",
      city: "Brno",
      postal_code: "602 00",
      country: "CZ",
      email: "objednavky@zlatyklas.cz",
    },
    items: [
      { id: "1", name: "Návrh loga a vizuální identity", quantity: 1, unit: "ks", unit_price: 18500, vat_rate: 21 },
      { id: "2", name: "Grafika obalů – 4 varianty", quantity: 4, unit: "ks", unit_price: 2750, vat_rate: 21 },
      { id: "3", name: "Konzultace a úpravy", quantity: 3.5, unit: "h", unit_price: 950, vat_rate: 21 },
      { id: "4", name: "Tisk vzorníku", quantity: 1, unit: "ks", unit_price: 1240.5, vat_rate: 12 },
    ],
    vatMode: vatPayer ? "vat" : "none",
    variableSymbol: "20260042",
    note: "Děkuji za spolupráci. Podklady ve vysokém rozlišení jsou ke stažení v odkazu z e-mailu.",
    style,
    accent: options.accent ?? null,
    qr: true,
    locale: options.locale ?? "cs",
  };
}
