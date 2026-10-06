import { SiteFooter } from "@/features/marketing/site-footer";
import { SiteHeader } from "@/features/marketing/site-header";
import { isPublicSignupEnabled } from "@/lib/signup";

/** The public website: its own header and footer, no sidebar, no Jarvis. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader signupEnabled={isPublicSignupEnabled()} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 md:px-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
