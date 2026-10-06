import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/features/marketing/seo";
import { APP_HOME_PATH } from "@/lib/routes";

/** The public website is open to crawlers; the app, the API and auth callbacks are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [APP_HOME_PATH, "/api/", "/auth/", "/design-system"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
