import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgot");
  return { title: t("title") };
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  const t = await getTranslations("auth.forgot");

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <Link href="/login" className={authLinkClass}>
          {t("back")}
        </Link>
      }
    >
      <ForgotPasswordForm expired={expired === "1"} />
    </AuthCard>
  );
}
