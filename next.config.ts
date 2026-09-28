import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // PDF text extraction (pdf.js inside) runs from node_modules, not bundled.
  serverExternalPackages: ["unpdf"],
};

export default withNextIntl(nextConfig);
