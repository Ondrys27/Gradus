"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { SubmitButton } from "@/features/auth/submit-button";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import { joinWaitlist } from "./waitlist-actions";
import type { WaitlistState } from "./waitlist";

/**
 * The waitlist while public sign-up is off: an e-mail and consent. The
 * address counts only after the link in the confirmation e-mail is opened.
 */
export function WaitlistDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where on the site the visitor asked, e.g. "header" or "hero". */
  source: string;
}) {
  const t = useTranslations("marketing.waitlist");
  const locale = useLocale();
  const [state, action] = useActionState<WaitlistState, FormData>(joinWaitlist, {});
  const emailError =
    state.error === "invalidEmail" ? t("errors.invalidEmail") : undefined;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={state.ok ? t("thanksTitle") : t("title")}
      closeLabel={t("close")}
    >
      {state.ok ? (
        <div className="flex flex-col items-start gap-3" role="status">
          <CheckCircle2Icon aria-hidden className="size-8 text-teal" />
          <p className="text-ink-soft">{t("thanks")}</p>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-soft">{t("description", { appName: APP_NAME })}</p>
          <input type="hidden" name="source" value={source} />
          {/* Never seen by people; bots fill it in. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="absolute -left-[9999px] size-px opacity-0"
          />
          <FormField id="waitlist-email" label={t("email")} error={emailError}>
            <Input
              {...fieldA11y("waitlist-email", emailError)}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              autoFocus
              defaultValue={state.email}
              key={state.email}
            />
          </FormField>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink-soft">
            <input
              type="checkbox"
              name="consent"
              required
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-violet"
            />
            <span>
              {t.rich("consent", {
                appName: APP_NAME,
                link: (chunks) => (
                  <Link
                    href={localizedPath("privacy", locale)}
                    className="text-violet underline underline-offset-4"
                    target="_blank"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>
          {state.error && state.error !== "invalidEmail" && (
            <FormAlert>{t(`errors.${state.error}`)}</FormAlert>
          )}
          <SubmitButton className="w-full">{t("submit")}</SubmitButton>
        </form>
      )}
    </ResponsiveDialog>
  );
}
