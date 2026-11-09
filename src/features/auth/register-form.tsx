"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { SparklesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PromoCodeField } from "@/features/promo/promo-code-field";
import { TRIAL_DAYS, type Billing, type PaidPlanKey } from "@/config/pricing";
import { browserTimeZone } from "@/lib/region";
import { localizedPath } from "@/lib/routes";
import { signUp } from "./actions";
import { CheckEmail } from "./resend-confirmation";
import { PASSWORD_MIN, type FormState } from "./schemas";
import { SubmitButton } from "./submit-button";

/** The plan picked on the website, with its name from the published catalog. */
export type RegisterPlan = { planKey: PaidPlanKey; billing: Billing; name: string };

const consentLink =
  "font-medium text-violet underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-violet/40";

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
  promoCode = "",
  chosenPlan = null,
}: {
  invite?: RegisterInvite | null;
  /** Public sign-up is on: without a code the account starts a trial. */
  codeOptional?: boolean;
  /** A partner's code from their link (…/?kod=XYZ, kept in a cookie for 30 days). */
  promoCode?: string;
  /** A plan picked on the website's pricing cards (?tarif=pro&obdobi=rok). */
  chosenPlan?: RegisterPlan | null;
}) {
  const t = useTranslations("auth");
  const tPlans = useTranslations("plans");
  const locale = useLocale();
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const err = (field: string) =>
    state.fieldErrors?.[field] && t(`errors.${state.fieldErrors[field]}`);
  // The browser's zone seeds the account's time zone, country and formats.
  const [timeZone, setTimeZone] = useState("");
  useEffect(() => setTimeZone(browserTimeZone()), []);

  // E-mail confirmation is on: the account waits for the link from the inbox.
  if (state.success && state.values?.email) return <CheckEmail email={state.values.email} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="timeZone" value={timeZone} />
      {chosenPlan && (
        <>
          <input type="hidden" name="plan" value={chosenPlan.planKey} />
          <input type="hidden" name="billing" value={chosenPlan.billing} />
          <p
            className="flex items-start gap-2 rounded-xl border border-violet/30 bg-violet/10 p-3 text-sm text-ink"
            data-testid="register-chosen-plan"
          >
            <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-violet" />
            {t("register.chosenPlan", {
              plan: chosenPlan.name,
              billing: tPlans(`billing.${chosenPlan.billing}`),
              days: TRIAL_DAYS,
            })}
          </p>
        </>
      )}
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
      {/* A worker joins a team: the owner pays, a partner's code is not theirs to use. */}
      {!invite && (
        <PromoCodeField
          name="promoCode"
          defaultValue={state.values?.promoCode ?? promoCode}
          serverProblem={state.promo}
          key={`p-${state.values?.promoCode}-${state.promo}`}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <ConsentBox
          name="terms"
          defaultChecked={state.values?.terms === "on"}
          key={`t-${state.values?.terms}-${state.fieldErrors?.terms}`}
          error={err("terms") || undefined}
          testId="register-terms"
        >
          {t.rich("register.terms", {
            terms: (chunks) => (
              <Link href={localizedPath("terms", locale)} target="_blank" className={consentLink}>
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href={localizedPath("privacy", locale)} target="_blank" className={consentLink}>
                {chunks}
              </Link>
            ),
          })}
        </ConsentBox>
        <ConsentBox
          name="marketing"
          defaultChecked={state.values?.marketing === "on"}
          key={`m-${state.values?.marketing}`}
          testId="register-marketing"
        >
          {t("register.marketing")}
        </ConsentBox>
      </div>
      {state.error && <FormAlert>{t(`errors.${state.error}`)}</FormAlert>}
      <SubmitButton className="mt-2 w-full">{t("register.submit")}</SubmitButton>
    </form>
  );
}

/**
 * One consent checkbox: the label wraps it, so a tap on the text ticks it
 * (the links inside open the documents in a new tab), and a hidden field
 * sends "on" with the form.
 */
function ConsentBox({
  name,
  defaultChecked,
  error,
  testId,
  children,
}: {
  name: string;
  defaultChecked: boolean;
  error?: string;
  testId: string;
  children: ReactNode;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const messageId = `register-${name}-message`;
  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name={name} value={checked ? "on" : ""} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-ink-soft">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => setChecked(value === true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? messageId : undefined}
          className="mt-0.5"
          data-testid={testId}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={messageId} className="text-xs text-pink" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
