import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { LEGACY_REDIRECTS } from "./src/lib/routes";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Avatars are public objects in Supabase Storage; next/image may fetch only those. */
function supabaseStoragePattern() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return [];
  const { protocol, hostname, port } = new URL(url);
  return [
    {
      protocol: protocol.replace(":", "") as "http" | "https",
      hostname,
      port,
      pathname: "/storage/v1/object/public/**",
    },
  ];
}

const nextConfig: NextConfig = {
  // The deployment's short commit for bug reports (src/lib/app-version.ts).
  env: {
    NEXT_PUBLIC_APP_VERSION: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "dev",
  },
  // A production build next to a running dev server (bun run e2e against a
  // build) needs its own folder; everything else keeps the default .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // PDF text extraction (pdf.js inside) and the invoice PDFs run from node_modules, not bundled.
  serverExternalPackages: ["unpdf", "@react-pdf/renderer"],
  // The invoice PDFs are drawn with the bundled fonts, read from disk by the routes.
  outputFileTracingIncludes: {
    "/api/invoices/**": ["./public/fonts/invoice/*.ttf"],
  },
  experimental: {
    // The dev-only segment explorer wraps segments in extra nodes that shift
    // React's useId between the server HTML and the browser, so every app page
    // logged a hydration mismatch in development (never in a build).
    devtoolSegmentExplorer: false,
  },
  images: {
    remotePatterns: supabaseStoragePattern(),
    formats: ["image/avif", "image/webp"],
  },
  // The app moved under /app; old addresses keep working with a permanent 301.
  async redirects() {
    return LEGACY_REDIRECTS.flatMap(([source, destination]) => [
      { source, destination, statusCode: 301 as const },
      {
        source: `${source}/:path+`,
        destination: `${destination}/:path+`,
        statusCode: 301 as const,
      },
    ]);
  },
};

export default withNextIntl(nextConfig);
