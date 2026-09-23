"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { changePassword } from "@/features/account/actions";
import { PASSWORD_MIN, type FormState } from "@/features/auth/schemas";
import { SubmitButton } from "@/features/auth/submit-button";

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const tp = useTranslations("profile.password");
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);
  const labels = { showLabel: t("fields.showPassword"), hideLabel: t("fields.hidePassword") };

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {/* Lets password managers attach the change to the right account. */}
      <FormField id="password-current" label={t("fields.currentPassword")} error={err("current")}>
        <PasswordInput
          {...fieldA11y("password-current", err("current"))}
          {...labels}
          name="current"
          autoComplete="current-password"
          required
        />
      </FormField>
      <FormField
        id="password-new"
        label={t("fields.newPassword")}
        error={err("password")}
        hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
      >
        <PasswordInput
          {...fieldA11y("password-new", err("password"), true)}
          {...labels}
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </FormField>
      <FormField id="password-confirm" label={t("fields.confirmPassword")} error={err("confirm")}>
        <PasswordInput
          {...fieldA11y("password-confirm", err("confirm"))}
          {...labels}
          name="confirm"
          autoComplete="new-password"
          required
        />
      </FormField>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      {state.success && <FormAlert tone="success">{tp("changed")}</FormAlert>}
      <div>
        <SubmitButton>{tp("submit")}</SubmitButton>
      </div>
    </form>
  );
}
