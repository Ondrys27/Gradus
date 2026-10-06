import { OG_SIZE, ogImageAlt, renderOgImage } from "@/features/marketing/og-image";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = ogImageAlt("en");

export default function Image() {
  return renderOgImage("en");
}
