import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("auth.login");

  return (
    <AuthCard
      title={t("title")}
      description={t("description", { appName: APP_NAME })}
      footer={t.rich("noAccount", {
        link: (chunks) => (
          <Link href="/register" className={authLinkClass}>
            {chunks}
          </Link>
        ),
      })}
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
