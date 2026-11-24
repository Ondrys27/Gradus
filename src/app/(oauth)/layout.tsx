import { AppRoot, appRootMetadata } from "@/components/app-root";
import { Logo } from "@/components/layout/logo";
import { APP_NAME } from "@/lib/constants";

export { rootViewport as viewport } from "@/components/root-document";
export const generateMetadata = appRootMetadata;

/** The consent screen of connected apps (28.8): alone, without the app around it. */
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRoot>
      <div className="flex min-h-dvh flex-col items-center px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="flex min-h-11 items-center gap-3">
          <Logo />
          <span className="text-lg font-bold tracking-tight text-ink">{APP_NAME}</span>
        </div>
        <main className="flex w-full max-w-md flex-1 flex-col justify-center py-8">{children}</main>
      </div>
    </AppRoot>
  );
}
