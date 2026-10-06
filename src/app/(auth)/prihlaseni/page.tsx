import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";

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
  const [t, locale] = await Promise.all([getTranslations("auth.login"), getLocale()]);

  return (
    <AuthCard
      title={t("title")}
      description={t("description", { appName: APP_NAME })}
      footer={t.rich(isPublicSignupEnabled() ? "noAccountPublic" : "noAccount", {
        link: (chunks) => (
          <Link href={localizedPath("register", locale)} className={authLinkClass}>
            {chunks}
          </Link>
        ),
      })}
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
