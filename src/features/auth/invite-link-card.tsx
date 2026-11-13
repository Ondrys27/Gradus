"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MailQuestionIcon, UserRoundCheckIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/routes";
import { APP_NAME } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { INVITES_PATH } from "@/lib/routes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { requestNewInvite } from "./invite-actions";
import { canRequestNewInvite, inviteAcceptPath, type InviteLinkProblem } from "./invite-link";

/**
 * A link that no longer works says why (expired on a date, used, declined,
 * replaced, revoked, unknown) and offers "Ask for a new one", which tells the
 * owner in the app. A used link also offers to sign in.
 */
export function InviteProblemCard({
  code,
  state,
  since,
  signedIn = false,
}: {
  code: string;
  state: InviteLinkProblem;
  since: string | null;
  signedIn?: boolean;
}) {
  const t = useTranslations("auth.inviteLink");
  const locale = useLocale();
  const settings = useFormatSettings();
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState<"sent" | "already" | "failed" | null>(null);
  const date = since ? formatDate(new Date(since), settings) : "";

  function ask() {
    startTransition(async () => {
      const result = await requestNewInvite(code);
      setAnswer(result.ok ? (result.sent ? "sent" : "already") : "failed");
    });
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-orange/40 bg-orange/10 p-5"
      data-testid="invite-problem"
      data-state={state}
    >
      <div className="flex items-start gap-3">
        <MailQuestionIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-orange" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-ink">{t("problemTitle")}</h2>
          <p className="text-sm text-ink-soft" data-testid="invite-problem-text">
            {t(`problem.${state}`, { date })}
          </p>
        </div>
      </div>
      {answer && (
        <p
          role="status"
          className={answer === "failed" ? "text-sm text-pink" : "text-sm text-green"}
          data-testid="invite-request-answer"
        >
          {answer === "sent" ? t("requested") : answer === "already" ? t("requestedAlready") : t("requestFailed")}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {state === "used" && !signedIn && (
          <Link href={loginPath(locale)} className={buttonVariants({ variant: "ghost" })}>
            {t("signIn")}
          </Link>
        )}
        {canRequestNewInvite(state) && answer !== "sent" && answer !== "already" && (
          <Button onClick={ask} disabled={pending} data-testid="invite-request-new">
            {t("requestNew")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** The invite belongs to an account that exists: sign in and accept it there, no new account. */
export function InviteSignInCard({ code, email }: { code: string; email: string | null }) {
  const t = useTranslations("auth.inviteLink");
  const locale = useLocale();
  const next = inviteAcceptPath(INVITES_PATH, code);
  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-teal/30 bg-teal/10 p-5"
      data-testid="invite-sign-in"
    >
      <div className="flex items-start gap-3">
        <UserRoundCheckIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-ink">
            {email
              ? t("signInTitle", { email, appName: APP_NAME })
              : t("signInTitleNoEmail", { appName: APP_NAME })}
          </h2>
          <p className="text-sm text-ink-soft">{t("signInText")}</p>
        </div>
      </div>
      {/* A plain link: the sign-in page reads `next` and comes back to the invite. */}
      <Link
        href={`${loginPath(locale)}?next=${encodeURIComponent(next)}`}
        className={buttonVariants({ className: "self-end" })}
        data-testid="invite-sign-in-link"
      >
        {t("signInButton")}
      </Link>
    </section>
  );
}

