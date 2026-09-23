"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { resetPassword } from "./actions";
import { PASSWORD_MIN, type FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState<FormState, FormData>(resetPassword, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormField
        id="reset-password"
        label={t("fields.newPassword")}
        error={err("password")}
        hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
      >
        <PasswordInput
          {...fieldA11y("reset-password", err("password"), true)}
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          autoFocus
          showLabel={t("fields.showPassword")}
          hideLabel={t("fields.hidePassword")}
        />
      </FormField>
      <FormField id="reset-confirm" label={t("fields.confirmPassword")} error={err("confirm")}>
        <PasswordInput
          {...fieldA11y("reset-confirm", err("confirm"))}
          name="confirm"
          autoComplete="new-password"
          required
          showLabel={t("fields.showPassword")}
          hideLabel={t("fields.hidePassword")}
        />
      </FormField>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      <SubmitButton className="mt-2 w-full">{t("reset.submit")}</SubmitButton>
    </form>
  );
}
