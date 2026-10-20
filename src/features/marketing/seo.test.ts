import { afterEach, describe, expect, it, vi } from "vitest";
import { seedPlanCatalog } from "@/features/plan/catalog-seed";
import {
  alternatesFor,
  INDEXED_PAGES,
  pageMetadata,
  serializeJsonLd,
  sitemapEntries,
  softwareApplicationJsonLd,
} from "./seo";

const PLANS = seedPlanCatalog();

afterEach(() => vi.unstubAllEnvs());

describe("hreflang", () => {
  it("points every page at both languages, Czech as x-default", () => {
    expect(alternatesFor("pricing", "en")).toEqual({
      canonical: "/en/pricing",
      languages: { cs: "/cenik", en: "/en/pricing", "x-default": "/cenik" },
    });
  });

  it("page metadata carries canonical, Open Graph locale and the title", () => {
    const meta = pageMetadata({
      page: "home",
      locale: "cs",
      title: "T",
      description: "D",
      absoluteTitle: true,
    });
    expect(meta.title).toEqual({ absolute: "T" });
    expect(meta.alternates?.canonical).toBe("/");
    expect(meta.openGraph).toMatchObject({
      locale: "cs_CZ",
      url: "/",
      title: "T",
      description: "D",
    });
  });
});

describe("sitemap", () => {
  it("lists each indexed page in both languages with absolute addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gradus.example/");
    const entries = sitemapEntries(new Date(0));
    expect(entries).toHaveLength(INDEXED_PAGES.length * 2);
    const home = entries.find((entry) => entry.url === "https://gradus.example/");
    expect(home?.alternates?.languages).toEqual({
      cs: "https://gradus.example/",
      en: "https://gradus.example/en",
    });
    expect(entries.every((entry) => entry.url.startsWith("https://gradus.example/"))).toBe(true);
    expect(entries.some((entry) => entry.url.includes("/app"))).toBe(false);
  });
});

describe("SoftwareApplication", () => {
  it("offers every published plan at its price, CZK and Czech names in Czech", () => {
    const data = softwareApplicationJsonLd({ locale: "cs", description: "D", plans: PLANS });
    expect(data.offers).toHaveLength(PLANS.length);
    PLANS.forEach((plan, index) => {
      expect(data.offers[index]).toMatchObject({
        name: plan.name.cs,
        price: plan.monthly.CZK,
        priceCurrency: "CZK",
      });
    });
    expect(data.offers.map((offer) => offer.name)).toEqual(["Solo", "Pro", "Tým"]);
  });

  it("uses EUR in English and adds the per-worker price for Team", () => {
    const data = softwareApplicationJsonLd({ locale: "en", description: "D", plans: PLANS });
    const plan = PLANS.find((candidate) => candidate.key === "team")!;
    const team = data.offers.find((offer) => offer.name === "Team");
    expect(team?.priceCurrency).toBe("EUR");
    expect(team?.priceSpecification).toEqual([
      expect.objectContaining({ price: plan.monthly.EUR, priceCurrency: "EUR" }),
      expect.objectContaining({ price: plan.per_worker?.EUR, priceCurrency: "EUR" }),
    ]);
  });

  it("follows the order and the prices of the catalog it is given", () => {
    const changed = structuredClone(PLANS);
    changed[0].order = 2;
    changed[2].order = 0;
    changed[0].monthly.CZK = 590;
    const data = softwareApplicationJsonLd({ locale: "cs", description: "D", plans: changed });
    expect(data.offers.map((offer) => [offer.name, offer.price])).toEqual([
      ["Tým", 890],
      ["Pro", 890],
      ["Solo", 590],
    ]);
  });

  it("cannot close its script tag", () => {
    const json = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual({ text: "</script><script>alert(1)</script>" });
  });
});
