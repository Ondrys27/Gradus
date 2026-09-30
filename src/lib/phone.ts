import {
  AsYouType,
  getCountryCallingCode,
  isSupportedCountry,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { DEFAULT_COUNTRY } from "./region";

/**
 * Every phone number goes through this module. Numbers are saved in E.164
 * ("+420777123456"); `formatPhone` shows them nationally for the user's own
 * country and internationally otherwise. `PhoneInput` is the only way to type one.
 */

/** A country libphonenumber knows, falling back to the app default. */
export function phoneCountry(code: string | null | undefined): CountryCode {
  const upper = (code ?? "").toUpperCase();
  return isSupportedCountry(upper) ? upper : (DEFAULT_COUNTRY as CountryCode);
}

/** "+420" for CZ. */
export function callingCodePrefix(country: string | null | undefined): string {
  return `+${getCountryCallingCode(phoneCountry(country))}`;
}

/**
 * Keeps what matters for a number: digits and one leading "+". The "00"
 * international prefix becomes "+", so a number pasted in any form reads the same.
 */
export function cleanPhoneInput(text: string): string {
  // A "+" before the first digit counts, as in "(+420) 777 123 456".
  const plus = /^\D*\+/.test(text);
  const digits = text.replace(/\D/g, "");
  if (plus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return digits;
}

/**
 * A number that can be read for sure: a valid one, or one written with its
 * prefix and of a length that exists there. Text with letters never is one.
 */
function readable(text: string, country: string | null | undefined) {
  if (/\p{L}/u.test(text)) return undefined;
  const clean = cleanPhoneInput(text);
  const parsed = parsePhoneNumberFromString(clean, phoneCountry(country));
  if (!parsed) return undefined;
  return parsed.isValid() || (clean.startsWith("+") && parsed.isPossible()) ? parsed : undefined;
}

/** Fewer digits than this are only a prefix, not a number worth saving. */
const MIN_SAVED_DIGITS = 4;

/**
 * The value to save: E.164 when the number can be read, the text as typed when
 * it cannot (saving is never blocked), `null` when there is nothing or only a prefix.
 */
export function toE164(text: string | null | undefined, country: string | null | undefined) {
  const raw = (text ?? "").trim();
  const clean = cleanPhoneInput(raw);
  if (clean.replace(/\D/g, "").length < MIN_SAVED_DIGITS) return null;
  const parsed = readable(raw, country);
  return parsed ? parsed.number : raw;
}

/** Whether a saved or typed number is a real one; a soft warning, never a block. */
export function isValidPhone(
  text: string | null | undefined,
  country: string | null | undefined,
): boolean {
  const clean = cleanPhoneInput(text ?? "");
  if (!clean) return true;
  if (/\p{L}/u.test(text ?? "")) return false;
  return isValidPhoneNumber(clean, phoneCountry(country));
}

/**
 * A number for reading: nationally when it is from the user's country
 * ("777 123 456"), internationally otherwise ("+421 905 111 222"). Text that
 * is not a number comes back as it was.
 */
export function formatPhone(
  value: string | null | undefined,
  userCountry: string | null | undefined,
): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const country = phoneCountry(userCountry);
  const parsed = readable(raw, country);
  if (!parsed) return raw;
  return parsed.country === country ? parsed.formatNational() : parsed.formatInternational();
}

/** A number inside the input: always with its prefix, grouped ("+420 777 123 456"). */
export function formatPhoneForInput(
  value: string | null | undefined,
  country: string | null | undefined,
): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const parsed = readable(raw, country);
  return parsed ? parsed.formatInternational() : raw;
}

/** Formats while typing; national digits are grouped by the user's country. */
export function formatAsYouType(text: string, country: string | null | undefined): string {
  const clean = cleanPhoneInput(text);
  if (!clean) return "";
  return new AsYouType(phoneCountry(country)).input(clean);
}

/** A `tel:` link always dials E.164; text that is not a number keeps its digits. */
export function telHref(value: string, country: string | null | undefined): string {
  const e164 = toE164(value, country);
  const target = e164 && e164.startsWith("+") ? e164 : cleanPhoneInput(value);
  return `tel:${target}`;
}

/** Characters that carry the number: digits and the leading plus. */
export function isPhoneSignificant(char: string): boolean {
  return /[\d+]/.test(char);
}

/** How many significant characters come before `position`. */
export function significantBefore(text: string, position: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(position, text.length); i++) {
    if (isPhoneSignificant(text[i])) count++;
  }
  return count;
}

/** Caret position right after the `count`-th significant character. */
export function caretAfterSignificant(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isPhoneSignificant(text[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return text.length;
}
