/**
 * Invoice totals, the same way the database computes them in
 * `invoice_totals()`: each line rounded to cents, VAT per rate from the sum of
 * that rate's lines (the recapitulation printed on the invoice), and a CZK
 * total rounded to whole crowns with the difference shown as rounding.
 * Integers (BigInt) all the way, so 1.005 never turns into 1.00 the way a
 * float would; halves round away from zero like Postgres `round(numeric)`.
 */

// BigInt() instead of literals: the build targets ES2017.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const TEN_THOUSAND = BigInt(10000);

export type VatMode = "none" | "vat";

export type InvoiceItem = {
  /** Stable key for reordering; never shown. */
  id: string;
  name: string;
  /** Up to three decimals. */
  quantity: number;
  unit: string;
  /** Without VAT, up to two decimals; negative for a discount or a credit note. */
  unit_price: number;
  /** Percent, up to two decimals; ignored unless the supplier is a VAT payer. */
  vat_rate: number;
};

export type VatLine = { rate: number; base: number; vat: number };

export type InvoiceTotals = {
  subtotal: number;
  vatTotal: number;
  rounding: number;
  total: number;
  /** One line per VAT rate, highest rate first; empty without VAT. */
  vatLines: VatLine[];
};

/** Currencies whose invoice total is rounded to whole units. */
export const ROUNDED_CURRENCIES: readonly string[] = ["CZK"];

/** A number with at most `decimals` decimals as an integer of that scale. */
function scaled(value: number, decimals: number): bigint {
  // toFixed works on the decimal text, so 0.1 + 0.2 style noise disappears.
  const [whole, fraction = ""] = Math.abs(value).toFixed(decimals).split(".");
  const digits = BigInt(whole + fraction.padEnd(decimals, "0"));
  return value < 0 ? -digits : digits;
}

/** a / b rounded half away from zero (b > 0). */
function divRound(a: bigint, b: bigint): bigint {
  const negative = a < ZERO;
  const abs = negative ? -a : a;
  const result = (abs * TWO + b) / (TWO * b);
  return negative ? -result : result;
}

/** Cents back to a number through its decimal text, exact for any amount an invoice holds. */
function toUnits(cents: bigint): number {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const text = `${abs / HUNDRED}.${String(abs % HUNDRED).padStart(2, "0")}`;
  return negative ? -Number(text) : Number(text);
}

/** One line without VAT, in cents. */
function lineCents(item: Pick<InvoiceItem, "quantity" | "unit_price">): bigint {
  // quantity · 1000 × price · 100 = units of 1e-5; to cents: / 1000.
  return divRound(scaled(item.quantity, 3) * scaled(item.unit_price, 2), THOUSAND);
}

/** One line without VAT, as shown on the invoice. */
export function lineTotal(item: Pick<InvoiceItem, "quantity" | "unit_price">): number {
  return toUnits(lineCents(item));
}

export function computeInvoiceTotals(
  items: readonly Pick<InvoiceItem, "quantity" | "unit_price" | "vat_rate">[],
  vatMode: VatMode,
  currency: string,
): InvoiceTotals {
  const perRate = new Map<bigint, bigint>();
  for (const item of items) {
    const rate = vatMode === "vat" ? scaled(item.vat_rate, 2) : ZERO;
    perRate.set(rate, (perRate.get(rate) ?? ZERO) + lineCents(item));
  }

  let subtotal = ZERO;
  let vatTotal = ZERO;
  const vatLines: VatLine[] = [];
  for (const [rate, base] of perRate) {
    // base (cents) × rate (hundredths of a percent) / 10 000 = cents of VAT.
    const vat = divRound(base * rate, TEN_THOUSAND);
    subtotal += base;
    vatTotal += vat;
    if (vatMode === "vat") vatLines.push({ rate: Number(rate) / 100, base: toUnits(base), vat: toUnits(vat) });
  }
  vatLines.sort((a, b) => b.rate - a.rate);

  const exact = subtotal + vatTotal;
  const total = ROUNDED_CURRENCIES.includes(currency) ? divRound(exact, HUNDRED) * HUNDRED : exact;
  return {
    subtotal: toUnits(subtotal),
    vatTotal: toUnits(vatTotal),
    rounding: toUnits(total - exact),
    total: toUnits(total),
    vatLines,
  };
}
