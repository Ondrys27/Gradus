import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContactDetail } from "@/features/contacts/contact-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("contacts") };
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactDetail id={id} />;
}
