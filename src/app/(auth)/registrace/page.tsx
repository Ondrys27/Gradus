import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { FormAlert } from "@/components/ui/form-alert";
import { RegisterForm, type RegisterInvite } from "@/features/auth/register-form";
import { wantsE2ePublicSignup } from "@/features/auth/signup-mode";
import { parseSignupPlan } from "@/features/auth/signup-plan";
import { findOpenWorkerInvite } from "@/features/auth/worker-invite";
import { planName } from "@/features/plan/catalog";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { promoCodeFromParam } from "@/features/promo/link";
import { promoFromCookie } from "@/features/promo/server/promo";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, locale] = await Promise.all([getTranslations("auth.register"), getLocale()]);
  const params = await searchParams;
  const { invite: inviteParam, kod } = params;
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

  // The tests' own run may show the public form outside production (signup-mode.ts).
  const publicSignup = isPublicSignupEnabled() || wantsE2ePublicSignup(await headers());
  // A plan picked on the website (?tarif=pro&obdobi=rok) goes with a trial only.
  const choice = publicSignup && !invite ? parseSignupPlan(params) : null;
  const chosenName = choice ? planName(await getPublishedPlans(), choice.planKey, locale) : null;
  // A partner's link: the code in the address, or the one the visit kept (30 days).
  const promoCode =
    promoCodeFromParam(typeof kod === "string" ? kod : null) ?? (await promoFromCookie()) ?? "";

  return (
    <AuthCard
      title={t("title")}
      description={
        publicSignup && !invite ? t("descriptionPublic") : t("description", { appName: APP_NAME })
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
      <RegisterForm
        invite={invite}
        codeOptional={publicSignup && !invite}
        promoCode={promoCode}
        chosenPlan={choice && chosenName ? { ...choice, name: chosenName } : null}
      />
      <p className="mt-4 text-xs text-ink-muted">
        {t.rich("usageNote", {
          appName: APP_NAME,
          link: (chunks) => (
            <Link href={`${localizedPath("privacy", locale)}#usage`} className={authLinkClass}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthCard>
  );
}
