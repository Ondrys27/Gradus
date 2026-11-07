"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/lib/constants";
import { loginPath } from "@/lib/auth/routes";
import { confirmEmailChange, type EmailChangeOutcome } from "./email-change-actions";

/**
 * Opened from the e-mail at the new address. Confirms from the browser rather
 * than on page load, so a mail scanner that only fetches the link changes nothing.
 */
export function EmailChangeConfirm({ token }: { token: string }) {
  const t = useTranslations("auth.emailChange");
  const locale = useLocale();
  const [result, setResult] = useState<EmailChangeOutcome | null>(
    token ? null : { ok: false, error: "invalid" },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirmEmailChange(token)
      .then(setResult)
      .catch(() => setResult({ ok: false, error: "failed" }));
  }, [token]);

  if (result === null) {
    return <Skeleton className="h-32 w-full rounded-card" />;
  }
  const Icon = result.ok ? CheckCircle2Icon : CircleAlertIcon;
  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status">
      <Icon aria-hidden className={result.ok ? "size-10 text-teal" : "size-10 text-pink"} />
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {result.ok ? t("doneTitle") : t("invalidTitle")}
      </h1>
      <p className="max-w-md text-ink-soft">
        {result.ok
          ? t("doneText", { appName: APP_NAME, email: result.email })
          : t(`errors.${result.error}`)}
      </p>
      <Link href={loginPath(locale)} className={buttonVariants({ variant: "outline" })}>
        {t("signIn")}
      </Link>
    </div>
  );
}
