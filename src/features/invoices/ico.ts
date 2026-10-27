/**
 * The Czech company ID (IČO): eight digits, the last one a mod 11 check of
 * the first seven with weights 8 … 2. Shorter ones are padded with zeros.
 */
export function normalizeIco(value: string): string | null {
  const digits = value.replace(/\s+/g, "");
  if (!/^\d{1,8}$/.test(digits)) return null;
  return digits.padStart(8, "0");
}

export function isValidIco(value: string): boolean {
  const ico = normalizeIco(value);
  if (!ico || ico === "00000000") return false;
  const sum = [...ico.slice(0, 7)].reduce((total, digit, index) => total + Number(digit) * (8 - index), 0);
  return (11 - (sum % 11)) % 10 === Number(ico[7]);
}
