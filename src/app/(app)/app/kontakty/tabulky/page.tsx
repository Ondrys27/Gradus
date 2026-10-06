import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TablesEditor } from "@/features/contacts/tables-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts.tableEditor");
  return { title: t("title") };
}

export default function ContactTablesPage() {
  return <TablesEditor />;
}
