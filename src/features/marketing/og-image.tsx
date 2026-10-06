import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import type { SiteLocale } from "@/lib/routes";
import { OG_TOKENS as TOKENS } from "./og-tokens";

export const OG_SIZE = { width: 1200, height: 630 };

/** Inter from the repository (OFL), with the Czech letters Satori's default font lacks. */
async function fonts() {
  const dir = path.join(process.cwd(), "src/features/marketing/og");
  const [bold, medium] = await Promise.all([
    readFile(path.join(dir, "Inter-Bold.woff")),
    readFile(path.join(dir, "Inter-Medium.woff")),
  ]);
  return [
    { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: medium, weight: 500 as const, style: "normal" as const },
  ];
}

/**
 * The image's alt text. Next.js wants it as a plain string export, so it is
 * read from the messages directly rather than through an async translator.
 */
export function ogImageAlt(locale: SiteLocale): string {
  const messages = locale === "cs" ? cs : en;
  return messages.marketing.meta.ogAlt.replace("{appName}", APP_NAME);
}

/** The name and the headline on the dark background with the grid and both glows. */
export async function renderOgImage(locale: SiteLocale): Promise<ImageResponse> {
  const t = await getTranslations({ locale, namespace: "marketing.home.hero" });
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        backgroundColor: TOKENS.canvas,
        backgroundImage: `linear-gradient(to right, ${TOKENS.grid} 1px, transparent 1px), linear-gradient(to bottom, ${TOKENS.grid} 1px, transparent 1px)`,
        backgroundSize: "100px 100px",
        fontFamily: "Inter",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -260,
          bottom: -360,
          width: 760,
          height: 760,
          borderRadius: 9999,
          background: `radial-gradient(circle, ${TOKENS.violet}88 0%, ${TOKENS.violet}00 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -220,
          top: -300,
          width: 640,
          height: 640,
          borderRadius: 9999,
          background: `radial-gradient(circle, ${TOKENS.teal}66 0%, ${TOKENS.teal}00 70%)`,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundImage: `linear-gradient(135deg, ${TOKENS.violet}, ${TOKENS.teal})`,
            color: TOKENS.canvas,
            fontSize: 38,
            fontWeight: 700,
          }}
        >
          {APP_NAME.charAt(0)}
        </div>
        <div style={{ color: TOKENS.ink, fontSize: 40, fontWeight: 700 }}>{APP_NAME}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            color: TOKENS.ink,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
            maxWidth: 980,
          }}
        >
          {t("title")}
        </div>
        <div style={{ color: TOKENS.inkSoft, fontSize: 30, fontWeight: 500 }}>{t("badge")}</div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: await fonts() },
  );
}
