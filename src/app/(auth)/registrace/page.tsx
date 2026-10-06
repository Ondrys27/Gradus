import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { FormAlert } from "@/components/ui/form-alert";
import { RegisterForm, type RegisterInvite } from "@/features/auth/register-form";
import { findOpenWorkerInvite } from "@/features/auth/worker-invite";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [t, locale] = await Promise.all([getTranslations("auth.register"), getLocale()]);
  const { invite: inviteParam } = await searchParams;
  const code = typeof inviteParam === "string" ? inviteParam.trim().slice(0, 64) : "";

  // A worker's link: fill in what the owner entered and say whose team it is.
  let invite: RegisterInvite | null = null;
  let inviteInvalid = false;
  if (code) {
    const open = await findOpenWorkerInvite(code).catch((error) => {
      console.error("[auth] worker invite preview failed", error);
      return null;
    });
    if (open) invite = { code, ...open };
    else inviteInvalid = true;
  }

  const publicSignup = isPublicSignupEnabled();

  return (
    <AuthCard
      title={t("title")}
      description={
        publicSignup && !invite
          ? t("descriptionPublic")
          : t("description", { appName: APP_NAME })
      }
      footer={t.rich("haveAccount", {
        link: (chunks) => (
          <Link href={localizedPath("login", locale)} className={authLinkClass}>
            {chunks}
          </Link>
        ),
      })}
    >
      {inviteInvalid && <FormAlert className="mb-4">{t("workerInviteInvalid")}</FormAlert>}
      <RegisterForm invite={invite} codeOptional={publicSignup && !invite} />
    </AuthCard>
  );
}
