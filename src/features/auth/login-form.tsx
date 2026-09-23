"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn } from "./actions";
import { authLinkClass } from "./auth-card";
import type { FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FormField id="login-email" label={t("fields.email")} error={err("email")}>
        <Input
          {...fieldA11y("login-email", err("email"))}
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
      <FormField
        id="login-password"
        label={t("fields.password")}
        error={err("password")}
        aside={
          <Link href="/forgot-password" className={`${authLinkClass} text-sm`}>
            {t("login.forgot")}
          </Link>
        }
      >
        <PasswordInput
          {...fieldA11y("login-password", err("password"))}
          name="password"
          autoComplete="current-password"
          required
          showLabel={t("fields.showPassword")}
          hideLabel={t("fields.hidePassword")}
        />
      </FormField>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      <SubmitButton className="mt-2 w-full">{t("login.submit")}</SubmitButton>
    </form>
  );
}
