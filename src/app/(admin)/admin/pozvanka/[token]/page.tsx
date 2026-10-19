import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, LinkIcon } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { GlowCard } from "@/components/ui/glow-card";
import { AdminLogin } from "@/features/admin/admin-login";
import { checkInviteLink } from "@/features/admin/server/attempts";
import { HOME_PATH } from "@/lib/auth/routes";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.invite");
  return { title: t("title", { appName: APP_NAME }), referrer: "no-referrer" };
}

/**
 * An invitation to the administration. A usable link leads through sign-in
 * or a new account, the authenticator and then into /admin; anything else
 * (unknown, used, revoked, expired, or too many tries from this address) gets
 * one neutral message.
 */
export default async function AdminInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [usable, t, tLogin] = await Promise.all([
    checkInviteLink(token),
    getTranslations("admin.invite"),
    getTranslations("admin.login"),
  ]);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex min-h-11 items-center gap-3">
        <Logo />
        <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
      </div>
      <main className="flex w-full max-w-md flex-1 flex-col justify-center py-8">
        {usable ? (
          <AdminLogin invite={token} />
        ) : (
          <GlowCard interactive={false} className="flex flex-col gap-3 p-6 md:p-8">
            <span className="grid size-10 place-items-center rounded-xl bg-violet/15 text-violet">
              <LinkIcon aria-hidden className="size-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-balance">{t("invalidTitle")}</h1>
            <p className="text-sm text-ink-soft">{t("invalidDescription")}</p>
          </GlowCard>
        )}
        <Link
          href={HOME_PATH}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-lg px-3 text-sm text-ink-soft transition-colors hover:text-ink focus-visible:text-ink"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          {tLogin("backToApp", { appName: APP_NAME })}
        </Link>
      </main>
    </div>
  );
}
