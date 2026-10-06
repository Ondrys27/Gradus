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
  // PDF text extraction (pdf.js inside) runs from node_modules, not bundled.
  serverExternalPackages: ["unpdf"],
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
