import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ColdCallingView } from "@/features/cold-calling/cold-calling-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("coldCalling") };
}

export default function ColdCallingPage() {
  return <ColdCallingView />;
}
