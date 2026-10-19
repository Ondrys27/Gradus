"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Loads the page again; a block that failed gets another chance. */
export function RetryButton() {
  const t = useTranslations("admin.empty");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCwIcon aria-hidden className={cn(pending && "animate-spin motion-reduce:animate-none")} />
      {t("retry")}
    </Button>
  );
}
