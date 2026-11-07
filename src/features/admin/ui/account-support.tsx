"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, KeyRoundIcon, LogOutIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  newEmailSchema,
  SUPPORT_REASON_MAX,
  supportReasonSchema,
  type SupportAction,
  type SupportError,
  type SupportResult,
} from "../account-support";
import {
  requestEmailChange,
  resendEmailConfirmation,
  sendPasswordReset,
  signOutEverywhere,
} from "../server/account-support-actions";

const ICONS: Record<SupportAction, typeof MailIcon> = {
  passwordReset: KeyRoundIcon,
  confirmation: MailCheckIcon,
  signOut: LogOutIcon,
  emailChange: MailIcon,
};

const textareaClass =
  "min-h-11 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30 aria-invalid:border-pink";

/** The sign-in e-mail with a Copy button. */
export function CopyEmail({ email }: { email: string }) {
  const t = useTranslations("admin.users.account");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="min-w-0 truncate text-base font-semibold text-ink select-all" data-testid="account-email">
        {email}
      </span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(email).then(
            () => setCopied(true),
            // Clipboard blocked: the address is selectable, so it can be copied by hand.
            () => undefined,
          );
        }}
        className="inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-xs text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
      >
        {copied ? (
          <CheckIcon aria-hidden className="size-3.5 text-teal" />
        ) : (
          <CopyIcon aria-hidden className="size-3.5" />
        )}
        {copied ? t("copied") : t("copy")}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}

/**
 * The support buttons of the Account card. Each asks for a reason (required,
 * it goes to the audit) and confirmation; the e-mail change also for the new
 * address. A link is never shown here: it goes only into the person's e-mail.
 */
export function AccountSupportActions({
  userId,
  email,
  actions,
}: {
  userId: string;
  email: string | null;
  actions: readonly SupportAction[];
}) {
  const t = useTranslations("admin.users.account");
  const [open, setOpen] = useState<SupportAction | null>(null);
  const [done, setDone] = useState<SupportAction | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" data-testid="account-actions">
        {actions.map((action) => {
          const Icon = ICONS[action];
          return (
            <Button
              key={action}
              type="button"
              variant={action === "signOut" ? "destructive" : "outline"}
              onClick={() => {
                setDone(null);
                setOpen(action);
              }}
            >
              <Icon aria-hidden />
              {t(`actions.${action}.button`)}
            </Button>
          );
        })}
      </div>
      {done && (
        <p role="status" className="text-sm text-teal" data-testid="account-action-done">
          {t(`actions.${done}.done`, { email: email ?? "" })}
        </p>
      )}
      {open && (
        <SupportDialog
          key={open}
          action={open}
          userId={userId}
          email={email}
          onClose={() => setOpen(null)}
          onDone={() => {
            setDone(open);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function SupportDialog({
  action,
  userId,
  email,
  onClose,
  onDone,
}: {
  action: SupportAction;
  userId: string;
  email: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.users.account");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [shown, setShown] = useState<{ reason: boolean; email: boolean }>({ reason: false, email: false });
  const [problem, setProblem] = useState<SupportError | null>(null);
  const [pending, startTransition] = useTransition();

  const reasonValid = supportReasonSchema.safeParse(reason).success;
  const emailValid = action !== "emailChange" || newEmailSchema.safeParse(newEmail).success;

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    setShown({ reason: !reasonValid, email: !emailValid });
    if (!reasonValid || !emailValid) return;
    startTransition(async () => {
      const failed = (): SupportResult => ({ ok: false, error: "failed" });
      const result = await (action === "passwordReset"
        ? sendPasswordReset(userId, reason)
        : action === "confirmation"
          ? resendEmailConfirmation(userId, reason)
          : action === "signOut"
            ? signOutEverywhere(userId, reason)
            : requestEmailChange(userId, newEmail, reason)
      ).catch(failed);
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  const target = action === "emailChange" && newEmailSchema.safeParse(newEmail).success
    ? newEmailSchema.parse(newEmail)
    : email ?? "";

  return (
    <ResponsiveDialog
      open
      onOpenChange={(next) => !next && !pending && onClose()}
      title={t(`actions.${action}.title`)}
      closeLabel={t("close")}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid={`account-dialog-${action}`}>
        <p className="text-sm text-ink-soft">
          {t(`actions.${action}.description`, { email: email ?? "" })}
        </p>
        {action === "emailChange" && (
          <FormField
            id="account-new-email"
            label={t("newEmailLabel")}
            error={shown.email && !emailValid ? t("errors.email") : undefined}
          >
            <Input
              {...fieldA11y("account-new-email", shown.email && !emailValid)}
              type="email"
              autoComplete="off"
              inputMode="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </FormField>
        )}
        <FormField
          id="account-reason"
          label={t("reasonLabel")}
          error={shown.reason && !reasonValid ? t("errors.reason") : undefined}
          hint={t("reasonHint")}
        >
          <textarea
            {...fieldA11y("account-reason", shown.reason && !reasonValid, true)}
            value={reason}
            maxLength={SUPPORT_REASON_MAX}
            rows={3}
            required
            onChange={(event) => setReason(event.target.value)}
            className={textareaClass}
          />
        </FormField>
        {action !== "signOut" && target && (
          <p className="text-xs text-ink-muted">{t("sendsTo", { email: target })}</p>
        )}
        {problem && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            variant={action === "signOut" ? "destructive" : "default"}
            disabled={pending}
          >
            {t(`actions.${action}.confirm`)}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
