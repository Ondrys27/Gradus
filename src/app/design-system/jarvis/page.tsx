import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { JarvisPlayground } from "@/features/design-system/jarvis-playground";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem.jarvisPage");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function JarvisDesignPage() {
  return (
    <main>
      <JarvisPlayground />
    </main>
  );
}
