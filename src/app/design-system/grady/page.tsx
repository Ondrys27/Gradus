import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GradyPlayground } from "@/features/design-system/grady-playground";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem.gradyPage");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function GradyDesignPage() {
  return (
    <main>
      <GradyPlayground />
    </main>
  );
}
