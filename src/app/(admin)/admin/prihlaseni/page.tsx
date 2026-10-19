import type { Metadata } from "next";
import Link from "next/link";
import { redirect, RedirectType } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { safeAdminNextPath } from "@/features/admin/access";
import { AdminLogin } from "@/features/admin/admin-login";
import { isBackupOfferPending } from "@/features/admin/server/backup-offer";
import { adminAccess } from "@/features/admin/server/guard";
import { HOME_PATH } from "@/lib/auth/routes";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.login");
  return { title: t("title") };
}

/**
 * The only way into the administration, shown to anyone. Whether the account
 * is the owner is decided after the password (anyone else gets the 404 then);
 * the owner with a live admin session goes straight on to `next`.
 *
 * Except right after the first authenticator: its code sets new session
 * cookies, so Next.js renders this page again in that action's answer, and
 * the backup offer must stay until the person decides (backup-offer.ts).
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeAdminNextPath(typeof rawNext === "string" ? rawNext : null);
  const session = await adminAccess();
  if (session && !(await isBackupOfferPending(session.userId))) redirect(next, RedirectType.replace);
  const t = await getTranslations("admin.login");

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex min-h-11 items-center gap-3">
        <Logo />
        <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
      </div>
      <main className="flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <AdminLogin next={next} />
        <Link
          href={HOME_PATH}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-lg px-3 text-sm text-ink-soft transition-colors hover:text-ink focus-visible:text-ink"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          {t("backToApp", { appName: APP_NAME })}
        </Link>
      </main>
    </div>
  );
}
