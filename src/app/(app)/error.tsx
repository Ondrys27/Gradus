"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorScreen } from "@/features/errors/error-screen";
import { APP_HOME_PATH } from "@/lib/routes";

/** A page of the app crashed: the error page inside the app's frame, without Jarvis. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // A server component that failed must be fetched again, not only re-rendered.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return <ErrorScreen error={error} onRetry={retry} home="app" homeHref={APP_HOME_PATH} />;
}
