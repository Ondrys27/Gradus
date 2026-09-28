import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { FormAlert } from "@/components/ui/form-alert";
import { RegisterForm, type RegisterInvite } from "@/features/auth/register-form";
import { findOpenWorkerInvite } from "@/features/auth/worker-invite";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const t = await getTranslations("auth.register");
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
      {inviteInvalid && <FormAlert className="mb-4">{t("workerInviteInvalid")}</FormAlert>}
      <RegisterForm invite={invite} />
    </AuthCard>
  );
}
