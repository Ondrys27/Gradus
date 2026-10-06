"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { localizedPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { WaitlistDialog } from "./waitlist-dialog";

/**
 * The main button of the website. With public sign-up it goes to the
 * registration (trial); without it, it opens the waitlist.
 */
export function SignupCta({
  signupEnabled,
  source,
  long = false,
  size = "default",
  className,
}: {
  signupEnabled: boolean;
  source: string;
  /** "Try free for 14 days" instead of "Try for free". */
  long?: boolean;
  size?: "default" | "lg";
  className?: string;
}) {
  const t = useTranslations("marketing.cta");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const classes = cn(buttonVariants({ size }), className);

  if (signupEnabled) {
    return (
      <Link href={localizedPath("register", locale)} className={classes}>
        {long ? t("trial") : t("tryFree")}
      </Link>
    );
  }
  return (
    <>
      <button type="button" className={classes} onClick={() => setOpen(true)}>
        {t("waitlist")}
      </button>
      <WaitlistDialog open={open} onOpenChange={setOpen} source={source} />
    </>
  );
}
