// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

vi.mock("server-only", () => ({}));
const { LEGAL_SECTIONS } = await import("./legal-page");
const { legalOperator } = await import("@/config/legal");

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
      for (const name of ["Supabase", "Vercel", "Anthropic", "Google Maps Platform", "Resend"]) {
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
    expect(legalOperator()).toEqual({
      name: "Jan Novák",
      companyId: null,
      address: null,
      email: "hello@example.com",
    });
  });
});
