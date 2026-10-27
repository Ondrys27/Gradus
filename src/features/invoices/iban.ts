/**
 * Bank accounts on invoices. A Czech account ("19-2000145399" with bank code
 * "0800") is turned into its IBAN the way ČNB defines it: CZ, two check
 * digits, the four-digit bank code, the prefix padded to six digits and the
 * number padded to ten. Both parts of a Czech account carry a mod 11 check.
 */

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

export const CZ_ACCOUNT_PATTERN = /^(?:(\d{1,6})-)?(\d{2,10})$/;
export const BANK_CODE_PATTERN = /^\d{4}$/;

function weightedOk(digits: string, weights: number[]): boolean {
  const padded = digits.padStart(weights.length, "0");
  const sum = [...padded].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return sum % 11 === 0;
}

/** Spaces dropped: "19-2000 145 399" is the same account. */
export function normalizeCzAccount(value: string): string {
  return value.replace(/\s+/g, "");
}

/** Whether the account number (prefix and number) passes the Czech mod 11 check. */
export function isValidCzAccount(accountNumber: string): boolean {
  const match = CZ_ACCOUNT_PATTERN.exec(normalizeCzAccount(accountNumber));
  if (!match) return false;
  const [, prefix = "", number] = match;
  if (/^0+$/.test(number)) return false;
  return (prefix === "" || weightedOk(prefix, PREFIX_WEIGHTS)) && weightedOk(number, NUMBER_WEIGHTS);
}

/** The remainder of a long digit string divided by 97, piece by piece. */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(`${remainder}${digits.slice(i, i + 7)}`) % 97;
  }
  return remainder;
}

/** Letters as numbers for the IBAN check (A = 10 … Z = 35). */
function ibanDigits(value: string): string {
  return [...value].map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char)).join("");
}

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Shape and the mod 97 check of ISO 13616. */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("CZ") && iban.length !== 24) return false;
  return mod97(ibanDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** The IBAN of a Czech account, or null when the account or bank code is not valid. */
export function czAccountToIban(accountNumber: string, bankCode: string): string | null {
  const account = normalizeCzAccount(accountNumber);
  const code = bankCode.trim();
  if (!BANK_CODE_PATTERN.test(code) || !isValidCzAccount(account)) return null;
  const match = CZ_ACCOUNT_PATTERN.exec(account);
  if (!match) return null;
  const [, prefix = "", number] = match;
  const bban = code + prefix.padStart(6, "0") + number.padStart(10, "0");
  const check = 98 - mod97(ibanDigits(`${bban}CZ00`));
  return `CZ${String(check).padStart(2, "0")}${bban}`;
}

/** "CZ65 0800 0000 1920 0014 5399" for reading. */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, "$1 ");
}

/** The account a payment goes to: a Czech account's IBAN, or the IBAN given. */
export function paymentIban(account: {
  country?: string | null;
  account_number?: string | null;
  bank_code?: string | null;
  iban?: string | null;
}): string | null {
  if (account.account_number && account.bank_code) {
    const iban = czAccountToIban(account.account_number, account.bank_code);
    if (iban) return iban;
  }
  return account.iban && isValidIban(account.iban) ? normalizeIban(account.iban) : null;
}
