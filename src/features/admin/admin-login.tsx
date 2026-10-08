"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { LoaderCircleIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { SubmitButton } from "@/features/auth/submit-button";
import { APP_NAME } from "@/lib/constants";
import { ADMIN_PATH } from "./access";
import {
  adminSignIn,
  startAdminEnrollment,
  verifyAdminCode,
  type AdminLoginError,
  type AdminSignInState,
} from "./server/login-actions";

type Step = "password" | "enroll" | "verify" | "backup" | "backupEnroll";
type Problem = { error: AdminLoginError; minutes?: number } | null;

/**
 * Password, then the code from the authenticator app. The first time, the
 * second factor is set up here (QR code, check with a code) and a backup
 * device is recommended. Every step is checked again on the server.
 */
export function AdminLogin() {
  const t = useTranslations("admin.login");
  const [step, setStep] = useState<Step>("password");
  const [restarted, setRestarted] = useState(false);

  // Stable, so the steps' effects run once per step.
  const restart = useCallback(() => {
    setRestarted(true);
    setStep("password");
  }, []);
  const enter = useCallback(() => window.location.assign(ADMIN_PATH), []);
  const toBackup = useCallback(() => setStep("backup"), []);
  const afterPassword = useCallback((next: "enroll" | "verify") => {
    setRestarted(false);
    setStep(next);
  }, []);

  return (
    <GlowCard interactive={false} className="flex flex-col gap-6 p-6 md:p-8">
      {step === "password" && <PasswordStep restarted={restarted} onNext={afterPassword} />}
      {step === "verify" && (
        <CodeStep
          title={t("verifyTitle")}
          description={t("verifyDescription")}
          submitLabel={t("verifySubmit")}
          onSubmit={(code) => verifyAdminCode({ mode: "login", code })}
          onDone={enter}
          onRestart={restart}
        />
      )}
      {step === "enroll" && <EnrollStep kind="primary" onDone={toBackup} onRestart={restart} />}
      {step === "backup" && (
        <div className="flex flex-col gap-5">
          <StepHeader
            icon={SmartphoneIcon}
            title={t("backupTitle")}
            description={t("backupDescription")}
          />
          <div className="flex flex-col gap-3">
            <Button size="lg" onClick={() => setStep("backupEnroll")}>
              {t("backupAdd")}
            </Button>
            <Button size="lg" variant="ghost" onClick={enter}>
              {t("backupSkip")}
            </Button>
          </div>
        </div>
      )}
      {step === "backupEnroll" && <EnrollStep kind="backup" onDone={enter} onRestart={enter} />}
    </GlowCard>
  );
}

function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheckIcon;
  title: string;
  description: string;
}) {
  return (
    <header className="flex flex-col gap-2">
      <span className="grid size-10 place-items-center rounded-xl bg-violet/15 text-violet">
        <Icon aria-hidden className="size-5" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
      <p className="text-sm text-ink-soft">{description}</p>
    </header>
  );
}

function ProblemAlert({ problem }: { problem: Problem }) {
  const t = useTranslations("admin.login.errors");
  if (!problem) return null;
  return (
    <FormAlert>
      {problem.error === "locked"
        ? t("locked", { minutes: problem.minutes ?? 15 })
        : t(problem.error)}
    </FormAlert>
  );
}

function PasswordStep({
  restarted,
  onNext,
}: {
  restarted: boolean;
  onNext: (next: "enroll" | "verify") => void;
}) {
  const t = useTranslations("admin.login");
  const tAuth = useTranslations("auth.fields");
  const [state, action] = useActionState<AdminSignInState, FormData>(adminSignIn, { ok: false });

  useEffect(() => {
    if (state.ok) onNext(state.next);
  }, [state, onNext]);

  const problem: Problem =
    !state.ok && state.error
      ? { error: state.error, minutes: state.minutes }
      : restarted
        ? { error: "restart" }
        : null;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <StepHeader
        icon={ShieldCheckIcon}
        title={t("title")}
        description={t("description", { appName: APP_NAME })}
      />
      <FormField id="admin-email" label={tAuth("email")}>
        <Input
          {...fieldA11y("admin-email", undefined)}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          defaultValue={!state.ok ? state.email : undefined}
        />
      </FormField>
      <FormField id="admin-password" label={tAuth("password")}>
        <PasswordInput
          {...fieldA11y("admin-password", undefined)}
          name="password"
          autoComplete="current-password"
          required
          showLabel={tAuth("showPassword")}
          hideLabel={tAuth("hidePassword")}
        />
      </FormField>
      <ProblemAlert problem={problem} />
      <SubmitButton className="w-full">{t("submit")}</SubmitButton>
    </form>
  );
}

function CodeStep({
  title,
  description,
  submitLabel,
  onSubmit,
  onDone,
  onRestart,
  children,
}: {
  title?: string;
  description?: string;
  submitLabel: string;
  onSubmit: (code: string) => ReturnType<typeof verifyAdminCode>;
  onDone: (next: "backup" | "admin") => void;
  onRestart: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("admin.login");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSubmit(code).catch(() => ({
        ok: false as const,
        error: "generic" as const,
      }));
      if (result.ok) return onDone(result.next);
      if (result.error === "restart") return onRestart();
      setProblem({
        error: result.error,
        minutes: "minutes" in result ? result.minutes : undefined,
      });
      setCode("");
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {title && <StepHeader icon={ShieldCheckIcon} title={title} description={description ?? ""} />}
      {children}
      <FormField id="admin-code" label={t("codeLabel")}>
        <Input
          {...fieldA11y("admin-code", undefined)}
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="text-center font-mono text-2xl tracking-[0.4em] tabular-nums"
        />
      </FormField>
      <ProblemAlert problem={problem} />
      <Button type="submit" size="lg" className="w-full" disabled={pending || code.length !== 6}>
        {pending && (
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        )}
        {submitLabel}
      </Button>
    </form>
  );
}

function EnrollStep({
  kind,
  onDone,
  onRestart,
}: {
  kind: "primary" | "backup";
  onDone: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("admin.login");
  const [factor, setFactor] = useState<{ factorId: string; qrCode: string; secret: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<Problem>(null);

  useEffect(() => {
    let cancelled = false;
    startAdminEnrollment(kind)
      .catch(() => ({ ok: false as const, error: "generic" as const }))
      .then((result) => {
        if (cancelled) return;
        if (result.ok) return setFactor(result);
        if (result.error === "restart") return onRestart();
        setProblem({ error: result.error });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, onRestart]);

  const title = kind === "primary" ? t("enrollTitle") : t("backupEnrollTitle");
  const description = kind === "primary" ? t("enrollDescription") : t("backupEnrollDescription");

  if (!factor) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader icon={ShieldCheckIcon} title={title} description={description} />
        {problem ? (
          <>
            <ProblemAlert problem={problem} />
            <Button size="lg" variant="ghost" onClick={onRestart}>
              {t("startOver")}
            </Button>
          </>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
            <LoaderCircleIcon
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {t("enrollLoading")}
          </p>
        )}
      </div>
    );
  }

  return (
    <CodeStep
      title={title}
      description={description}
      submitLabel={t("enrollSubmit")}
      onSubmit={(code) =>
        verifyAdminCode({
          mode: kind === "primary" ? "enroll" : "backup",
          code,
          factorId: factor.factorId,
        })
      }
      onDone={onDone}
      onRestart={onRestart}
    >
      <ol className="flex flex-col gap-1.5 text-sm text-ink-soft">
        <li>{t("enrollStepScan")}</li>
        <li>{t("enrollStepCode")}</li>
      </ol>
      <div className="flex justify-center">
        {/* Supabase returns the QR code as an SVG data URL; it holds the secret, so it never goes through an image optimiser. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={factor.qrCode}
          alt={t("qrAlt")}
          width={192}
          height={192}
          className="size-48 rounded-xl bg-white p-2"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-soft">{t("secretLabel")}</span>
        <code className="rounded-lg border border-line bg-surface-hover px-3 py-2 font-mono text-sm break-all select-all">
          {factor.secret}
        </code>
      </div>
      {kind === "primary" && <p className="text-xs text-ink-soft">{t("backupHint")}</p>}
    </CodeStep>
  );
}
