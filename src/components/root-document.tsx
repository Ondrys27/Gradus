import type { CSSProperties, ReactNode } from "react";
import type { Viewport } from "next";
import { Bricolage_Grotesque, Fraunces, Inter, Poppins, Sora, Space_Grotesk } from "next/font/google";
import { Background } from "@/components/layout/background";
import { cn } from "@/lib/utils";
import "@/app/globals.css";

// next/font downloads the font at build time and serves it from our own domain.
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });

// The heading faces a custom theme may pick (30.6). Not preloaded: the browser
// fetches one only when a custom theme's headings use it.
const poppins = Poppins({
  variable: "--font-heading-poppins",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
  preload: false,
});
const bricolage = Bricolage_Grotesque({
  variable: "--font-heading-bricolage",
  subsets: ["latin", "latin-ext"],
  preload: false,
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading-space-grotesk",
  subsets: ["latin", "latin-ext"],
  preload: false,
});
const fraunces = Fraunces({
  variable: "--font-heading-fraunces",
  subsets: ["latin", "latin-ext"],
  preload: false,
});
const sora = Sora({ variable: "--font-heading-sora", subsets: ["latin", "latin-ext"], preload: false });

const HEADING_FONT_VARIABLES = cn(
  poppins.variable,
  bricolage.variable,
  spaceGrotesk.variable,
  fraunces.variable,
  sora.variable,
);

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

/** A custom theme's variables and attributes on <html> (30.6); a built-in theme has none. */
export type RootAppearance = {
  style: Record<string, string>;
  attrs: Record<string, string>;
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
  appearance,
  className,
  backdrop = "app",
  children,
}: {
  lang: string;
  theme: string;
  appearance?: RootAppearance;
  className?: string;
  /** "app" draws the grid and the two glows; "plain" is the bare canvas (the public website). */
  backdrop?: "app" | "plain";
  children: ReactNode;
}) {
  return (
    <html
      lang={lang}
      data-theme={theme}
      {...appearance?.attrs}
      style={appearance && Object.keys(appearance.style).length ? (appearance.style as CSSProperties) : undefined}
      className={cn("dark", inter.variable, backdrop === "app" && HEADING_FONT_VARIABLES, className)}
    >
      <body className={backdrop === "plain" ? "bg-canvas" : undefined}>
        {backdrop === "app" && <Background />}
        {children}
      </body>
    </html>
  );
}
