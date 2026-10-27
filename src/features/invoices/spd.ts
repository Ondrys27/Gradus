/**
 * QR Platba: the Short Payment Descriptor of the Czech Banking Association
 * (ČBA), version 1.0. Fields are "KEY:value" joined by "*"; a value may never
 * contain "*". Only CZK, and only to an IBAN.
 */

export const SPD_CURRENCY = "CZK";
/** ČBA limits: an amount of up to 10 characters, a message of up to 60. */
const MAX_AMOUNT = 9_999_999.99;
const MAX_MESSAGE = 60;

export type SpdPayment = {
  iban: string;
  /** Optional; appended to the account as "+BIC". */
  bic?: string | null;
  amount: number;
  currency: string;
  /** Digits only, up to ten; anything else is left out. */
  variableSymbol?: string | null;
  message?: string | null;
};

/** Without diacritics and the field separator, so every bank app reads it. */
function cleanText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*\r\n]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** Whether a payment can be offered as a QR Platba at all. */
export function canPayBySpd(payment: Pick<SpdPayment, "amount" | "currency" | "iban">): boolean {
  return (
    payment.currency === SPD_CURRENCY &&
    /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(payment.iban) &&
    payment.amount > 0 &&
    payment.amount <= MAX_AMOUNT
  );
}

/** The text in the QR code, or null when this payment cannot be one. */
export function buildSpd(payment: SpdPayment): string | null {
  if (!canPayBySpd(payment)) return null;
  const bic = payment.bic && /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(payment.bic) ? `+${payment.bic}` : "";
  const fields = [
    "SPD",
    "1.0",
    `ACC:${payment.iban}${bic}`,
    `AM:${payment.amount.toFixed(2)}`,
    `CC:${SPD_CURRENCY}`,
  ];
  const vs = payment.variableSymbol?.trim();
  if (vs && /^\d{1,10}$/.test(vs)) fields.push(`X-VS:${vs}`);
  const message = payment.message ? cleanText(payment.message) : "";
  if (message) fields.push(`MSG:${message}`);
  return fields.join("*");
}

/** The default variable symbol of an invoice: the digits of its number, at most the last ten. */
export function variableSymbolFor(number: string | null | undefined): string | null {
  const digits = (number ?? "").replace(/\D/g, "").slice(-10);
  return digits || null;
}
