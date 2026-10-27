import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvoicePage } from "@/features/invoices/invoice-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("pageTitle") };
}

export default async function InvoiceByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoicePage id={id} />;
}
