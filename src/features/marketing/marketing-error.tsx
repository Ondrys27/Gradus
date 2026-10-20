"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorScreen } from "@/features/errors/error-screen";
import { localizedPath, type SiteLocale } from "@/lib/routes";

/** The website's error page, between its header and footer, in the page's language. */
export function MarketingError({
  error,
  reset,
  locale,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  locale: SiteLocale;
}) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4">
      <ErrorScreen
        error={error}
        onRetry={retry}
        home="site"
        homeHref={localizedPath("home", locale)}
        display
      />
    </div>
  );
}
