import type { Metadata, MetadataRoute } from "next";
import { monthlyPrice, PAID_PLANS, perWorkerPrice, priceCurrencyFor } from "@/config/pricing";
import { APP_NAME } from "@/lib/constants";
import { LOCALIZED_PAGES, SITE_LOCALES, type SiteLocale } from "@/lib/routes";

/** Public pages that belong in search results, in both languages. */
export const INDEXED_PAGES = ["home", "pricing", "terms", "privacy"] as const;
export type IndexedPage = (typeof INDEXED_PAGES)[number];

const OG_LOCALE: Record<SiteLocale, string> = { cs: "cs_CZ", en: "en_US" };

/** Absolute base of the public site; NEXT_PUBLIC_SITE_URL in production. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path === "/" ? "/" : path}`;
}

/** Canonical address plus hreflang alternates; Czech is the x-default. */
export function alternatesFor(page: IndexedPage, locale: SiteLocale): Metadata["alternates"] {
  const paths = LOCALIZED_PAGES[page];
  return {
    canonical: paths[locale],
    languages: { cs: paths.cs, en: paths.en, "x-default": paths.cs },
  };
}

/** Title, description, hreflang and Open Graph of one public page. */
export function pageMetadata({
  page,
  locale,
  title,
  description,
  absoluteTitle = false,
}: {
  page: IndexedPage;
  locale: SiteLocale;
  title: string;
  description: string;
  /** The home page's title stands alone, without the "· Gradus" template. */
  absoluteTitle?: boolean;
}): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: alternatesFor(page, locale),
    openGraph: {
      type: "website",
      siteName: APP_NAME,
      locale: OG_LOCALE[locale],
      alternateLocale: SITE_LOCALES.filter((other) => other !== locale).map((o) => OG_LOCALE[o]),
      url: LOCALIZED_PAGES[page][locale],
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Every indexed page in both languages, each with its hreflang alternates. */
export function sitemapEntries(lastModified: Date): MetadataRoute.Sitemap {
  return INDEXED_PAGES.flatMap((page) =>
    SITE_LOCALES.map((locale) => ({
      url: absoluteUrl(LOCALIZED_PAGES[page][locale]),
      lastModified,
      changeFrequency:
        page === "home" || page === "pricing" ? ("weekly" as const) : ("yearly" as const),
      priority: page === "home" ? 1 : page === "pricing" ? 0.8 : 0.3,
      alternates: {
        languages: Object.fromEntries(
          SITE_LOCALES.map((other) => [other, absoluteUrl(LOCALIZED_PAGES[page][other])]),
        ),
      },
    })),
  );
}

/**
 * schema.org SoftwareApplication with one offer per plan, prices from
 * src/config/pricing.ts in the page's currency, without VAT.
 */
export function softwareApplicationJsonLd({
  locale,
  description,
  planNames,
}: {
  locale: SiteLocale;
  description: string;
  planNames: Record<(typeof PAID_PLANS)[number]["key"], string>;
}) {
  const currency = priceCurrencyFor(locale);
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: APP_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    url: absoluteUrl(LOCALIZED_PAGES.home[locale]),
    description,
    offers: PAID_PLANS.map((plan) => {
      const perWorker = perWorkerPrice(plan, currency, "monthly");
      const monthly = {
        "@type": "UnitPriceSpecification",
        price: monthlyPrice(plan, currency, "monthly"),
        priceCurrency: currency,
        billingDuration: "P1M",
        valueAddedTaxIncluded: false,
      };
      return {
        "@type": "Offer",
        name: planNames[plan.key],
        price: monthly.price,
        priceCurrency: currency,
        url: absoluteUrl(LOCALIZED_PAGES.pricing[locale]),
        priceSpecification:
          perWorker === null
            ? monthly
            : [
                monthly,
                {
                  "@type": "UnitPriceSpecification",
                  price: perWorker,
                  priceCurrency: currency,
                  billingDuration: "P1M",
                  referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "worker" },
                  valueAddedTaxIncluded: false,
                },
              ],
      };
    }),
  };
}

/** JSON for a `<script type="application/ld+json">`, safe against `</script>` in texts. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
