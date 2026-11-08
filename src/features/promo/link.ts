/**
 * What a promo code looks like and how a partner's link carries it
 * (…/?kod=XYZ). Kept free of other imports: the middleware uses it on every
 * request to keep the code in a cookie for 30 days.
 */

export const PROMO_CODE_MIN = 4;
export const PROMO_CODE_MAX = 16;
export const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/** The address parameter of a partner's link and the cookie that keeps it. */
export const PROMO_PARAM = "kod";
export const PROMO_COOKIE = "gradus_promo";
export const PROMO_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const DIACRITICS = /[̀-ͯ]/g;
const SEPARATORS = /[\s_-]+/g;

/**
 * What a person typed, as a code: without diacritics, spaces, dashes and
 * underscores, in capitals ("jan-2026 " → "JAN2026"). Not necessarily valid.
 */
export function normalizePromoCode(input: string): string {
  return input.normalize("NFD").replace(DIACRITICS, "").replace(SEPARATORS, "").toUpperCase();
}

export function isPromoCode(code: string): boolean {
  return PROMO_CODE_PATTERN.test(code);
}

/** The code of a partner's link, when the address has one that can be a code. */
export function promoCodeFromParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = normalizePromoCode(value.slice(0, 64));
  return isPromoCode(code) ? code : null;
}
