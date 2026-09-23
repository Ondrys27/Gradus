import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionPlaceholder } from "@/components/layout/section-placeholder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("coldCalling") };
}

export default function ColdCallingPage() {
  return <SectionPlaceholder section="coldCalling" />;
}
