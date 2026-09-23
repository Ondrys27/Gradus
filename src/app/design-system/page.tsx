import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DesignSystemShowcase } from "@/features/design-system/design-system-showcase";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem");
  return { title: `${t("title")} · ${APP_NAME}`, robots: { index: false, follow: false } };
}

export default function DesignSystemPage() {
  return (
    <main>
      <DesignSystemShowcase />
    </main>
  );
}
