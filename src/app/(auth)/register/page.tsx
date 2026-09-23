import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { RegisterForm } from "@/features/auth/register-form";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage() {
  const t = await getTranslations("auth.register");

  return (
    <AuthCard
      title={t("title")}
      description={t("description", { appName: APP_NAME })}
      footer={t.rich("haveAccount", {
        link: (chunks) => (
          <Link href="/login" className={authLinkClass}>
            {chunks}
          </Link>
        ),
      })}
    >
      <RegisterForm />
    </AuthCard>
  );
}
