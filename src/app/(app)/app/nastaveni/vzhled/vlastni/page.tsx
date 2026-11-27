import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ThemeEditor } from "@/features/appearance/ui/theme-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.appearance.editor");
  return { title: t("titleNew") };
}

/** Settings → Appearance → Create your own (30.6): the editor of a custom theme, over the whole screen. */
export default function Page() {
  return <ThemeEditor />;
}
