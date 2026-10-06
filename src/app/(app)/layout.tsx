import { redirect } from "next/navigation";
import { AppRoot, appRootMetadata } from "@/components/app-root";
import { AppShell } from "@/components/layout/app-shell";
import { loadAccount } from "@/features/account/load-account";
import { SessionProvider } from "@/features/account/session-provider";
import { getLocale } from "next-intl/server";
import { loginPath } from "@/lib/auth/routes";

export { rootViewport as viewport } from "@/components/root-document";
export const generateMetadata = appRootMetadata;

/**
 * The one place the session is verified. Next.js keeps this layout mounted
 * across page changes, so it runs when the app starts, not on every click.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await loadAccount();
  if (!account) redirect(loginPath(await getLocale()));

  return (
    <AppRoot>
      <SessionProvider initial={account}>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </AppRoot>
  );
}
