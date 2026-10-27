import { countryName, formatCalendarDate, formatNumber, type FormatSettings } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { formatIban, paymentIban } from "../iban";
import { buildSpd } from "../spd";
import { computeInvoiceTotals, lineTotal, type InvoiceItem, type VatMode } from "../totals";
import {
  DEFAULT_ACCENT,
  type InvoiceKind,
  type InvoiceParty,
  type InvoiceStyle,
  type SupplierSnapshot,
} from "../types";
import { qrPath, type QrPath } from "./qr";

/**
 * Everything printed on an invoice, already worded and formatted, so the four
 * templates only lay it out. Built the same way for the PDF on the server and
 * for the live preview in the browser.
 */

/** Texts under `invoices.document` in the document's language. */
export type DocText = (key: string, values?: Record<string, string | number>) => string;

export type DocPair = { label: string; value: string };

export type DocParty = {
  heading: string;
  name: string;
  lines: string[];
  ids: DocPair[];
  contact: string[];
};

export type DocItem = {
  key: string;
  name: string;
  quantity: string;
  unitPrice: string;
  vatRate: string | null;
  total: string;
};

export type InvoiceDocument = {
  style: InvoiceStyle;
  accent: string;
  /** Metadata of the PDF file. */
  fileTitle: string;
  author: string;
  title: string;
  numberLabel: string;
  number: string;
  creditFor: string | null;
  supplier: DocParty;
  customer: DocParty;
  dates: DocPair[];
  payment: DocPair[];
  vatPayer: boolean;
  columns: { item: string; quantity: string; unitPrice: string; vatRate: string; total: string };
  items: DocItem[];
  emptyItems: string | null;
  totals: DocPair[];
  due: DocPair;
  vatRecap: {
    heading: string;
    columns: { rate: string; base: string; vat: string; total: string };
    rows: { rate: string; base: string; vat: string; total: string }[];
  } | null;
  note: DocPair | null;
  footer: string | null;
  qr: (QrPath & { caption: string }) | null;
  pageLabel: (page: number, pages: number) => string;
};

export type DocumentInput = {
  kind: InvoiceKind;
  number: string | null;
  creditForNumber?: string | null;
  issuedOn: string | null;
  taxableOn: string | null;
  dueOn: string | null;
  currency: string;
  supplier: SupplierSnapshot;
  customer: InvoiceParty;
  items: InvoiceItem[];
  vatMode: VatMode;
  variableSymbol: string | null;
  note: string | null;
  style: InvoiceStyle;
  accent: string | null;
  /** Whether a QR Platba belongs on this invoice (CZ account owner, CZK, switched on). */
  qr: boolean;
  /** The language of the document, for country names. */
  locale: string;
};

function partyLines(party: InvoiceParty, locale: string, own: string | undefined): string[] {
  const town = [party.postal_code, party.city].filter(Boolean).join(" ");
  const lines = [party.street, town].filter((line): line is string => Boolean(line));
  // The country is written out only when it differs from the supplier's own.
  if (party.country && party.country !== own) lines.push(countryName(party.country, locale));
  return lines;
}

/** Up to three decimals, only as many as the number has. */
function quantityDecimals(value: number): number {
  for (let decimals = 0; decimals < 3; decimals += 1) {
    if (Math.abs(value * 10 ** decimals - Math.round(value * 10 ** decimals)) < 1e-9) return decimals;
  }
  return 3;
}

export function buildInvoiceDocument(
  input: DocumentInput,
  t: DocText,
  settings: FormatSettings,
): InvoiceDocument {
  const money = (value: number) =>
    formatNumber(value, { style: "currency", currency: input.currency, decimals: 2 }, settings);
  const date = (value: string | null) => (value ? formatCalendarDate(value, settings) : "—");
  const percent = (value: number) =>
    `${formatNumber(value, { decimals: quantityDecimals(value) > 2 ? 2 : quantityDecimals(value) }, settings)} %`;

  const vatPayer = input.vatMode === "vat";
  const credit = input.kind === "credit_note";
  const supplier = input.supplier;
  const ownCountry = supplier.country;
  const totals = computeInvoiceTotals(input.items, input.vatMode, input.currency);
  const number = input.number ?? t("draftNumber");

  const supplierIds: DocPair[] = [];
  if (supplier.company_reg_no) supplierIds.push({ label: t("companyRegNo"), value: supplier.company_reg_no });
  if (supplier.vat_no) supplierIds.push({ label: t("vatNo"), value: supplier.vat_no });
  const customerIds: DocPair[] = [];
  if (input.customer.company_reg_no)
    customerIds.push({ label: t("companyRegNo"), value: input.customer.company_reg_no });
  if (input.customer.vat_no) customerIds.push({ label: t("vatNo"), value: input.customer.vat_no });

  const dates: DocPair[] = [{ label: t("issuedOn"), value: date(input.issuedOn) }];
  if (vatPayer) dates.push({ label: t("taxableOn"), value: date(input.taxableOn ?? input.issuedOn) });
  if (!credit) dates.push({ label: t("dueOn"), value: date(input.dueOn) });

  const iban = paymentIban(supplier);
  const payment: DocPair[] = [];
  if (!credit) payment.push({ label: t("paymentMethod"), value: t("bankTransfer") });
  if (supplier.account_number && supplier.bank_code) {
    payment.push({ label: t("account"), value: `${supplier.account_number}/${supplier.bank_code}` });
  }
  if (iban) payment.push({ label: t("iban"), value: formatIban(iban) });
  if (supplier.bic) payment.push({ label: t("bic"), value: supplier.bic });
  payment.push({ label: t("variableSymbol"), value: input.variableSymbol ?? (input.number ? "—" : t("draftSymbol")) });

  const items: DocItem[] = input.items.map((item) => ({
    key: item.id,
    name: item.name || "—",
    quantity: [
      formatNumber(item.quantity, { decimals: quantityDecimals(item.quantity) }, settings),
      item.unit,
    ]
      .filter(Boolean)
      .join(" "),
    unitPrice: money(item.unit_price),
    vatRate: vatPayer ? percent(item.vat_rate) : null,
    total: money(lineTotal(item)),
  }));

  const totalRows: DocPair[] = [
    { label: vatPayer ? t("subtotal") : t("itemsTotal"), value: money(totals.subtotal) },
  ];
  if (vatPayer) {
    for (const line of totals.vatLines) {
      if (line.rate > 0) totalRows.push({ label: t("vatAt", { rate: percent(line.rate) }), value: money(line.vat) });
    }
  }
  if (totals.rounding !== 0) totalRows.push({ label: t("rounding"), value: money(totals.rounding) });

  const spd =
    input.qr && iban && !credit
      ? buildSpd({
          iban,
          bic: supplier.bic,
          amount: totals.total,
          currency: input.currency,
          variableSymbol: input.variableSymbol,
          message: input.number,
        })
      : null;

  const titleKey = credit ? (vatPayer ? "titleCreditNoteVat" : "titleCreditNote") : vatPayer ? "titleInvoiceVat" : "titleInvoice";

  return {
    style: input.style,
    accent: input.accent ?? DEFAULT_ACCENT,
    fileTitle: `${t(credit ? "titleCreditNote" : "titleInvoice")} ${number}`,
    author: supplier.name ?? "",
    title: t(titleKey),
    numberLabel: t("number"),
    number,
    creditFor: credit && input.creditForNumber ? t("creditFor", { number: input.creditForNumber }) : null,
    supplier: {
      heading: t("supplier"),
      name: supplier.name ?? "",
      lines: partyLines(supplier, input.locale, ownCountry),
      ids: vatPayer ? supplierIds : [...supplierIds, { label: "", value: t("notVatPayer") }],
      contact: [supplier.email, supplier.phone ? formatPhone(supplier.phone, ownCountry) : null].filter(
        (line): line is string => Boolean(line),
      ),
    },
    customer: {
      heading: t("customer"),
      name: input.customer.name || t("noCustomer"),
      lines: partyLines(input.customer, input.locale, ownCountry),
      ids: customerIds,
      contact: input.customer.email ? [input.customer.email] : [],
    },
    dates,
    payment,
    vatPayer,
    columns: {
      item: t("columnItem"),
      quantity: t("columnQuantity"),
      unitPrice: t("columnUnitPrice"),
      vatRate: t("columnVat"),
      total: vatPayer ? t("columnTotalNet") : t("columnTotal"),
    },
    items,
    emptyItems: items.length ? null : t("noItems"),
    totals: totalRows,
    due: { label: credit ? t("creditTotal") : t("totalDue"), value: money(totals.total) },
    vatRecap:
      vatPayer && totals.vatLines.length
        ? {
            heading: t("vatRecap"),
            columns: { rate: t("recapRate"), base: t("recapBase"), vat: t("recapVat"), total: t("recapTotal") },
            rows: totals.vatLines.map((line) => ({
              rate: percent(line.rate),
              base: money(line.base),
              vat: money(line.vat),
              total: money(line.base + line.vat),
            })),
          }
        : null,
    note: input.note ? { label: t("note"), value: input.note } : null,
    footer: supplier.footer_text ?? null,
    qr: spd ? { ...qrPath(spd), caption: t("qrCaption") } : null,
    pageLabel: (page, pages) => t("page", { page, pages }),
  };
}
