"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { localizedPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

// The dialog and its form load only when someone asks for the waitlist.
const WaitlistDialog = dynamic(
  () => import("./waitlist-dialog").then((mod) => mod.WaitlistDialog),
  {
    ssr: false,
  },
);

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
  const [requested, setRequested] = useState(false);
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
      <button
        type="button"
        className={classes}
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
        // Start fetching the dialog as soon as the pointer is on its way.
        onPointerEnter={() => void import("./waitlist-dialog")}
      >
        {t("waitlist")}
      </button>
      {requested && <WaitlistDialog open={open} onOpenChange={setOpen} source={source} />}
    </>
  );
}
