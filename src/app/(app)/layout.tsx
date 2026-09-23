import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { loadAccount } from "@/features/account/load-account";
import { SessionProvider } from "@/features/account/session-provider";
import { LOGIN_PATH } from "@/lib/auth/routes";

/**
 * The one place the session is verified. Next.js keeps this layout mounted
 * across page changes, so it runs when the app starts, not on every click.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await loadAccount();
  if (!account) redirect(LOGIN_PATH);

  return (
    <SessionProvider initial={account}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
