import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotesView } from "@/features/notes/notes-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("notes") };
}

export default function NotesPage() {
  return <NotesView />;
}
