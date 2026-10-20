"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_PATH } from "@/features/admin/access";
import { ErrorScreen } from "@/features/errors/error-screen";

/** A page of the administration crashed: the error page on its plain canvas. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <ErrorScreen error={error} onRetry={retry} home="admin" homeHref={ADMIN_PATH} />
    </main>
  );
}
