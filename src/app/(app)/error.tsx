"use client";

import { useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { reportClientError } from "@/lib/analytics/analytics-provider";

/** A page of the app crashed: say so, offer a retry, and record the error without its data. */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common.pageError");
  useEffect(() => reportClientError(error, "boundary"), [error]);
  return (
    <EmptyState
      icon={<TriangleAlertIcon aria-hidden />}
      title={t("title")}
      description={t("description")}
      action={<Button onClick={reset}>{t("retry")}</Button>}
    />
  );
}
