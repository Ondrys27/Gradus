import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { Background } from "@/components/layout/background";
import { cn } from "@/lib/utils";
import "@/app/globals.css";

// next/font downloads the font at build time and serves it from our own domain.
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });

/**
 * Exported as `viewport` by every root layout. `viewport-fit=cover` lets the
 * page run under the notch and the home indicator, which is what makes
 * `env(safe-area-inset-*)` non-zero on iOS; every fixed bar pads itself by those insets.
 */
export const rootViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The `<html>` and `<body>` every root layout shares. The site has several
 * root layouts (the app, the sign-in pages, the public website in each
 * language) so that the public website can be generated statically while the
 * app keeps reading the session and the theme cookie on every request.
 */
export function RootDocument({
  lang,
  theme,
  className,
  children,
}: {
  lang: string;
  theme: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <html lang={lang} data-theme={theme} className={cn("dark", inter.variable, className)}>
      <body>
        <Background />
        {children}
      </body>
    </html>
  );
}
