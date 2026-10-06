import Link from "next/link";
import { getLocale } from "next-intl/server";
import { Logo } from "@/components/layout/sidebar";
import { GuestLocaleSwitcher } from "@/features/auth/guest-locale-switcher";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <Link
        href={localizedPath("home", locale)}
        className="flex min-h-11 items-center gap-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Logo />
        <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
      </Link>
      <main className="flex w-full max-w-md flex-1 flex-col justify-center py-8">{children}</main>
      <GuestLocaleSwitcher />
    </div>
  );
}
