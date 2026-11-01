"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { resendConfirmation } from "./actions";
import type { FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

/** "Send the link again" for an account whose e-mail is not confirmed yet. */
export function ResendConfirmation({ email }: { email: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState<FormState, FormData>(resendConfirmation, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="email" value={email} />
      {state.success ? (
        <FormAlert tone="success">{t("confirm.resent")}</FormAlert>
      ) : (
        state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>
      )}
      <SubmitButton variant="outline" className="w-full">
        {t("confirm.resend")}
      </SubmitButton>
    </form>
  );
}

/** After sign-up with confirmation on: where the link went and how to get another. */
export function CheckEmail({ email }: { email: string }) {
  const t = useTranslations("auth.confirm");
  return (
    <div className="flex flex-col gap-4" data-testid="check-email">
      <div
        role="status"
        className="flex flex-col gap-1.5 rounded-xl border border-teal/30 bg-teal/10 p-4"
      >
        <p className="font-semibold text-ink">{t("title")}</p>
        <p className="text-sm text-ink-soft">{t("sent", { email })}</p>
        <p className="text-sm text-ink-muted">{t("hint")}</p>
      </div>
      <ResendConfirmation email={email} />
    </div>
  );
}
