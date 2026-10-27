import { z } from "zod";

/**
 * ARES, the Czech business register: the public REST API answers a company
 * ID with the name, VAT number and registered address. Only the server calls
 * it (src/features/invoices/server/ares.ts); this file reads the answer.
 */

export const ARES_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";

const addressSchema = z
  .object({
    kodStatu: z.string().optional(),
    nazevObce: z.string().optional(),
    nazevCastiObce: z.string().optional(),
    nazevMestskeCastiObvodu: z.string().optional(),
    nazevUlice: z.string().optional(),
    cisloDomovni: z.number().optional(),
    cisloOrientacni: z.number().optional(),
    cisloOrientacniPismeno: z.string().optional(),
    psc: z.number().optional(),
    textovaAdresa: z.string().optional(),
  })
  .loose();

const subjectSchema = z
  .object({
    ico: z.string(),
    obchodniJmeno: z.string(),
    dic: z.string().optional(),
    sidlo: addressSchema.optional(),
  })
  .loose();

export type AresCompany = {
  name: string;
  companyRegNo: string;
  vatNo: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
};

/** "11000" → "110 00", as Czech post codes are written. */
function formatPsc(psc: number | undefined): string | null {
  if (!psc) return null;
  const digits = String(psc).padStart(5, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** The answer of ARES as the supplier's fields, or null when it is not a company record. */
export function parseAresSubject(json: unknown): AresCompany | null {
  const parsed = subjectSchema.safeParse(json);
  if (!parsed.success) return null;
  const { ico, obchodniJmeno, dic, sidlo } = parsed.data;
  let street: string | null = null;
  let city: string | null = null;
  if (sidlo) {
    const place = sidlo.nazevUlice ?? sidlo.nazevCastiObce ?? sidlo.nazevObce ?? "";
    const orientation = sidlo.cisloOrientacni
      ? `/${sidlo.cisloOrientacni}${sidlo.cisloOrientacniPismeno ?? ""}`
      : "";
    const number = sidlo.cisloDomovni ? `${sidlo.cisloDomovni}${orientation}` : "";
    street = [place, number].filter(Boolean).join(" ") || null;
    city = sidlo.nazevObce ?? null;
    // Prague and the other cities with districts are written "Praha 1", not just "Praha".
    if (city && sidlo.nazevMestskeCastiObvodu && /^Praha \d+$/.test(sidlo.nazevMestskeCastiObvodu)) {
      city = sidlo.nazevMestskeCastiObvodu;
    }
  }
  return {
    name: obchodniJmeno.trim(),
    companyRegNo: ico,
    vatNo: dic?.trim() || null,
    street,
    city,
    postalCode: formatPsc(sidlo?.psc),
    country: sidlo?.kodStatu && /^[A-Z]{2}$/.test(sidlo.kodStatu) ? sidlo.kodStatu : "CZ",
  };
}
