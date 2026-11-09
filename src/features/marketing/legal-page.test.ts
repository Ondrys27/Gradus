// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

vi.mock("server-only", () => ({}));
const { LEGAL_SECTIONS } = await import("./legal-page");
const { assertLegalComplete, legalOperator } = await import("@/config/legal");
const { legalGaps, placeholdersIn } = await import("@/config/legal-gaps");

type Messages = { [key: string]: string | Messages };

afterEach(() => vi.unstubAllEnvs());

describe("legal texts", () => {
  it.each([
    ["cs", cs],
    ["en", en],
  ] as const)(
    "%s has every section and paragraph the page shows, and nothing more",
    (_, messages) => {
      const legal = messages.marketing.legal as unknown as Messages;
      const sections = legal.sections as Record<string, Record<string, string>>;
      const bodies = legal.bodies as Record<string, Record<string, Record<string, string>>>;
      for (const [kind, map] of Object.entries(LEGAL_SECTIONS)) {
        expect(Object.keys(sections[kind])).toEqual(Object.keys(map));
        expect(Object.keys(bodies[kind])).toEqual(Object.keys(map));
        for (const [section, paragraphs] of Object.entries(map)) {
          expect(Object.keys(bodies[kind][section])).toEqual([...paragraphs]);
        }
      }
    },
  );

  it("carries the beta note and no made-up operator details", () => {
    expect(cs.marketing.legal.betaNotice).toBe(
      "Verze pro betu, před spuštěním projde revizí právníka",
    );
    expect(cs.marketing.legal.missing).toBe("[DOPLNIT]");
    const all = JSON.stringify([cs.marketing.legal, en.marketing.legal]);
    // The operator only through placeholders filled from the configuration.
    expect(all).not.toMatch(/IČO \d|company ID \d|\b\d{8}\b/);
    for (const placeholder of ["{name}", "{companyId}", "{address}", "{email}"]) {
      expect(JSON.stringify(cs.marketing.legal.bodies.privacy.controller)).toContain(placeholder);
      expect(JSON.stringify(en.marketing.legal.bodies.privacy.controller)).toContain(placeholder);
    }
  });

  it("names every processor in both languages", () => {
    for (const messages of [cs, en]) {
      const processors = JSON.stringify(messages.marketing.legal.bodies.privacy.processors);
      for (const name of ["Supabase", "Vercel", "Anthropic", "Google Maps Platform", "Resend", "Stripe"]) {
        expect(processors).toContain(name);
      }
    }
  });
});

describe("legalOperator", () => {
  it("reads the operator from the environment and leaves gaps empty", () => {
    vi.stubEnv("LEGAL_NAME", "  Jan Novák  ");
    vi.stubEnv("LEGAL_COMPANY_ID", "");
    vi.stubEnv("LEGAL_ADDRESS", "");
    vi.stubEnv("CONTACT_EMAIL", "hello@example.com");
    vi.stubEnv("LEGAL_BACKUP_DAYS", "seven");
    expect(legalOperator()).toEqual({
      name: "Jan Novák",
      companyId: null,
      address: null,
      email: "hello@example.com",
      backupDays: null,
    });
  });
});

describe("[DOPLNIT] in production", () => {
  const complete = {
    name: "Jan Novák",
    companyId: "12345678",
    address: "Ulice 1, Praha",
    email: "hello@example.com",
    backupDays: "7",
  };

  it("names every value the owner still has to fill in", () => {
    expect(legalGaps(complete)).toEqual([]);
    expect(legalGaps({ ...complete, companyId: null, backupDays: null }).map((gap) => gap.env)).toEqual([
      "LEGAL_COMPANY_ID",
      "LEGAL_BACKUP_DAYS",
    ]);
  });

  it("fails the production build while anything is missing, never elsewhere", () => {
    const gaps = { ...complete, address: null };
    expect(() => assertLegalComplete(gaps, true)).toThrow(/LEGAL_ADDRESS/);
    expect(() => assertLegalComplete(gaps, false)).not.toThrow();
    expect(() => assertLegalComplete(complete, true)).not.toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => assertLegalComplete(gaps)).toThrow(/\[DOPLNIT\]/);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertLegalComplete(gaps)).not.toThrow();
  });

  it("has no [DOPLNIT] written into the texts: every gap comes from the configuration", () => {
    for (const messages of [cs, en]) {
      expect(placeholdersIn(messages.marketing.legal.bodies)).toEqual([]);
      expect(placeholdersIn(messages.marketing.legal.sections)).toEqual([]);
    }
    expect(placeholdersIn({ a: { b: "x [DOPLNIT] y" }, c: "ok" })).toEqual(["a.b"]);
  });

  it("covers what payments need in both languages", () => {
    for (const messages of [cs, en]) {
      const terms = messages.marketing.legal.bodies.terms;
      for (const section of ["seller", "prices", "renewal", "cancellation", "withdrawal", "complaints"]) {
        expect(terms).toHaveProperty(section);
      }
      expect(JSON.stringify(terms.seller)).toContain("{companyId}");
      expect(JSON.stringify(terms.prices)).toContain("Stripe");
    }
  });
});
