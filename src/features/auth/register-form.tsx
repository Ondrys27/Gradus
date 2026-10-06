"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { browserTimeZone } from "@/lib/region";
import { signUp } from "./actions";
import { PASSWORD_MIN, type FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

/** A worker invite opened from the owner's link: prefilled, and says whose team it is. */
export type RegisterInvite = {
  code: string;
  workerName: string;
  email: string | null;
  ownerName: string | null;
};

export function RegisterForm({
  invite,
  codeOptional = false,
}: {
  invite?: RegisterInvite | null;
  /** Public sign-up is on: without a code the account starts a trial. */
  codeOptional?: boolean;
}) {
  const t = useTranslations("auth");
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);
  // The browser's zone seeds the account's time zone, country and formats.
  const [timeZone, setTimeZone] = useState("");
  useEffect(() => setTimeZone(browserTimeZone()), []);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="timeZone" value={timeZone} />
      {invite && (
        <p className="rounded-xl border border-teal/30 bg-teal/10 p-3 text-sm text-teal">
          {invite.ownerName
            ? t("register.workerInvite", { owner: invite.ownerName })
            : t("register.workerInviteNoOwner")}
        </p>
      )}
      <FormField
        id="register-invite"
        label={codeOptional ? t("register.inviteOptional") : t("fields.inviteCode")}
        error={err("inviteCode")}
        hint={codeOptional ? t("register.inviteOptionalHint") : t("register.inviteHint")}
      >
        <Input
          {...fieldA11y("register-invite", err("inviteCode"), true)}
          name="inviteCode"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required={!codeOptional}
          autoFocus={!codeOptional}
          defaultValue={state.values?.inviteCode ?? invite?.code}
          key={`i-${state.values?.inviteCode}`}
        />
      </FormField>
      <FormField id="register-name" label={t("fields.displayName")} error={err("displayName")}>
        <Input
          {...fieldA11y("register-name", err("displayName"))}
          name="displayName"
          autoFocus={codeOptional}
          autoComplete="name"
          maxLength={60}
          defaultValue={state.values?.displayName ?? invite?.workerName}
          key={`n-${state.values?.displayName}`}
        />
      </FormField>
      <FormField id="register-email" label={t("fields.email")} error={err("email")}>
        <Input
          {...fieldA11y("register-email", err("email"))}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.values?.email ?? invite?.email ?? undefined}
          key={`e-${state.values?.email}`}
        />
      </FormField>
      <FormField
        id="register-password"
        label={t("fields.password")}
        error={err("password")}
        hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
      >
        <PasswordInput
          {...fieldA11y("register-password", err("password"), true)}
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          showLabel={t("fields.showPassword")}
          hideLabel={t("fields.hidePassword")}
        />
      </FormField>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      <SubmitButton className="mt-2 w-full">{t("register.submit")}</SubmitButton>
    </form>
  );
}
