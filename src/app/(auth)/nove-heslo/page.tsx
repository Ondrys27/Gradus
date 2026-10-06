import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/features/auth/auth-card";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return { title: t("title") };
}

/** Reached from the recovery e-mail; the middleware requires the recovery session. */
export default async function ResetPasswordPage() {
  const t = await getTranslations("auth.reset");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ResetPasswordForm />
    </AuthCard>
  );
}
