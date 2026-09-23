import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DesignSystemShowcase } from "@/features/design-system/design-system-showcase";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default function DesignSystemPage() {
  return (
    <main>
      <DesignSystemShowcase />
    </main>
  );
}
