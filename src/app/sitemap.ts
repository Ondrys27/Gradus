import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/features/marketing/seo";

/** The public pages in both languages with their hreflang alternates. */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(new Date());
}
