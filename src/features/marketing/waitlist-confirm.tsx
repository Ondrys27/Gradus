"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import { confirmWaitlist } from "./waitlist-actions";

/**
 * Opened from the confirmation e-mail. Confirms from the browser rather than
 * on page load, so a mail scanner that only fetches the link confirms nothing.
 */
export function WaitlistConfirm({ token }: { token: string }) {
  const t = useTranslations("marketing.waitlistConfirmed");
  const locale = useLocale();
  const [result, setResult] = useState<boolean | null>(token ? null : false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirmWaitlist(token)
      .then((outcome) => setResult(outcome.ok))
      .catch(() => setResult(false));
  }, [token]);

  if (result === null) {
    return <Skeleton className="h-32 w-full rounded-card" />;
  }
  const Icon = result ? CheckCircle2Icon : CircleAlertIcon;
  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status">
      <Icon aria-hidden className={result ? "size-10 text-teal" : "size-10 text-pink"} />
      <h1 className="text-3xl font-bold tracking-tight text-ink">
        {result ? t("title") : t("invalidTitle")}
      </h1>
      <p className="max-w-md text-ink-soft">
        {result ? t("text", { appName: APP_NAME }) : t("invalidText")}
      </p>
      <Link href={localizedPath("home", locale)} className={buttonVariants({ variant: "outline" })}>
        {t("back")}
      </Link>
    </div>
  );
}
