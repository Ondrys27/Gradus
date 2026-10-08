import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/layout/logo";
import { ADMIN_PATH } from "@/features/admin/access";
import { AdminLogin } from "@/features/admin/admin-login";
import { adminAccess, isOwnerAccount } from "@/features/admin/server/guard";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.login");
  return { title: t("title") };
}

/**
 * The only way into the administration. A signed-in account that is not the
 * owner gets the 404 here too; the owner with a live admin session goes on.
 */
export default async function AdminLoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId && !(await isOwnerAccount(userId))) notFound();
  if (userId && (await adminAccess())) redirect(ADMIN_PATH);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex min-h-11 items-center gap-3">
        <Logo />
        <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
      </div>
      <main className="flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <AdminLogin />
      </main>
    </div>
  );
}
