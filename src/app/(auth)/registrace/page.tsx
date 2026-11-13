import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthCard, authLinkClass } from "@/features/auth/auth-card";
import { InviteProblemCard, InviteSignInCard } from "@/features/auth/invite-link-card";
import { inviteLinkView, type InviteLinkView } from "@/features/auth/invite-link";
import { RegisterForm, type RegisterInvite } from "@/features/auth/register-form";
import { wantsE2ePublicSignup } from "@/features/auth/signup-mode";
import { parseSignupPlan } from "@/features/auth/signup-plan";
import {
  accountExistsForEmail,
  loadWorkerInviteLink,
  type WorkerInviteLink,
} from "@/features/auth/worker-invite";
import { track } from "@/lib/analytics/track";
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

  // A worker's link: what it says is read, never changed (e-mail scanners open
  // it first). Open = the form filled in; an existing account = sign in and
  // accept; otherwise why it no longer works. Signed-in visitors never get
  // here: the middleware sends them to the invites page (invite-link.ts).
  let invite: RegisterInvite | null = null;
  let link: WorkerInviteLink | null = null;
  let view: InviteLinkView | null = null;
  if (code) {
    link = await loadWorkerInviteLink(code).catch((error) => {
      console.error("[auth] worker invite preview failed", error);
      return null;
    });
    const accountForEmail =
      link?.status.state === "open" && link.invite?.email
        ? await accountExistsForEmail(link.invite.email).catch(() => false)
        : false;
    view = inviteLinkView({
      state: link?.status.state ?? "unknown",
      invite: link?.invite ?? null,
      viewer: null,
      accountForEmail,
    });
    if (view.kind === "register" && link?.workerName) {
      invite = { code, workerName: link.workerName, email: link.email, ownerName: link.ownerName };
    }
    await track(
      "worker_invite_link_opened",
      { state: link?.status.state ?? "unknown", view: view.kind, signed_in: false },
      { userId: null },
    );
  }
  const inviteNotice =
    view?.kind === "problem" ? (
      <InviteProblemCard code={code} state={view.state} since={link?.status.since ?? null} />
    ) : view?.kind === "sign_in" ? (
      <InviteSignInCard code={code} email={link?.email ?? null} />
    ) : null;
  // A link that stopped working, or one for an existing account, replaces the
  // form. An unknown code (a mangled link, or no worker link at all) keeps it:
  // the person may still have a beta code to type.
  const showForm = !inviteNotice || (view?.kind === "problem" && view.state === "unknown");

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
      {inviteNotice && <div className={showForm ? "mb-4" : undefined}>{inviteNotice}</div>}
      {showForm && (
        <RegisterForm
          invite={invite}
          codeOptional={publicSignup && !invite}
          promoCode={promoCode}
          chosenPlan={choice && chosenName ? { ...choice, name: chosenName } : null}
        />
      )}
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
