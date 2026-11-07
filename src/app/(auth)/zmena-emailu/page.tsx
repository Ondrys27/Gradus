import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmailChangeConfirm } from "@/features/auth/email-change-confirm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.emailChange");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<{ token?: string | string[] }> };

/** Reached from the e-mail at the new address; open with or without a session. */
export default async function EmailChangePage({ searchParams }: Props) {
  const { token } = await searchParams;
  const value = (Array.isArray(token) ? token[0] : token) ?? "";
  return <EmailChangeConfirm token={value} />;
}
