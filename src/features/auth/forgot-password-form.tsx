"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "./actions";
import type { FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

export function ForgotPasswordForm({ expired }: { expired?: boolean }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);

  if (state.success) {
    return (
      <FormAlert tone="success">{t("forgot.sent", { email: state.values?.email ?? "" })}</FormAlert>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {expired && !state.error && <FormAlert>{t("errors.linkExpired")}</FormAlert>}
      <FormField id="forgot-email" label={t("fields.email")} error={err("email")}>
        <Input
          {...fieldA11y("forgot-email", err("email"))}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          defaultValue={state.values?.email}
          key={state.values?.email}
        />
      </FormField>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      <SubmitButton className="mt-2 w-full">{t("forgot.submit")}</SubmitButton>
    </form>
  );
}
