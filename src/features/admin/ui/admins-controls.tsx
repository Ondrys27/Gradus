"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, MailIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { formatDateTime } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import {
  createAdminInvite,
  removeAdmin,
  revokeAdminInvite,
  sendAdminInviteEmail,
} from "../server/admins-actions";

type Problem = "forbidden" | "invalid" | "failed";
type Created = { id: string; url: string; expiresAt: string; email: string };

/**
 * "Invite an administrator": optional e-mail and note, then the one-time
 * link with Copy and, when an e-mail was given, Send by e-mail. Closing the
 * dialog forgets the link for good; only its hash is stored.
 */
export function InviteAdminButton() {
  const t = useTranslations("admin.admins.invite");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [mail, setMail] = useState<"sent" | "failed" | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function reset(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setEmail("");
      setNote("");
      setProblem(null);
      setCreated(null);
      setMail(null);
      if (created) router.refresh();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await createAdminInvite({ email, note }).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      if (!result.ok) return setProblem(result.error);
      setCreated({ id: result.id, url: result.url, expiresAt: result.expiresAt, email: email.trim() });
    });
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link is selectable, so it can be copied by hand.
    }
  }

  function send() {
    if (!created) return;
    const token = created.url.split("/").pop() ?? "";
    startTransition(async () => {
      const result = await sendAdminInviteEmail(created.id, token).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      setMail(result.ok ? "sent" : "failed");
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <UserPlusIcon aria-hidden />
        {t("open")}
      </Button>
      <ResponsiveDialog open={open} onOpenChange={reset} title={t("title")} closeLabel={t("close")}>
        {created ? (
          <div className="flex flex-col gap-4" data-testid="admin-invite-result">
            <p className="text-sm text-ink-soft">{t("onceOnly")}</p>
            <code
              className="rounded-lg border border-line bg-surface-hover px-3 py-2 font-mono text-sm break-all select-all"
              data-testid="admin-invite-link"
            >
              {created.url}
            </code>
            <p className="text-xs text-ink-muted">
              {t("expires", {
                at: formatDateTime(new Date(created.expiresAt), ADMIN_FORMAT_SETTINGS),
              })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={() => void copy()}>
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? t("copied") : t("copy")}
              </Button>
              {created.email && (
                <Button type="button" variant="ghost" disabled={pending || mail === "sent"} onClick={send}>
                  <MailIcon aria-hidden />
                  {mail === "sent" ? t("emailSent") : t("sendEmail")}
                </Button>
              )}
            </div>
            {created.email && <p className="text-xs text-ink-muted">{t("emailHint")}</p>}
            {mail === "failed" && <FormAlert>{t("emailFailed")}</FormAlert>}
            <span aria-live="polite" className="sr-only">
              {copied ? t("copied") : mail === "sent" ? t("emailSent") : ""}
            </span>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">{t("description")}</p>
            <FormField id="invite-email" label={t("emailLabel")} hint={t("emailOptional")}>
              <Input
                {...fieldA11y("invite-email", undefined, true)}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField id="invite-note" label={t("noteLabel")} hint={t("noteHint")}>
              <Input
                {...fieldA11y("invite-note", undefined, true)}
                autoComplete="off"
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
            {problem && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => reset(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("create")}
              </Button>
            </div>
          </form>
        )}
      </ResponsiveDialog>
    </>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const t = useTranslations("admin.admins.revoke");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await revokeAdminInvite(id).catch(() => ({ ok: false }) as const);
      if (!result.ok) return setFailed(true);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={t("title")}
        description={t("description")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={pending}
        error={failed ? t("failed") : null}
        onConfirm={confirm}
      />
    </>
  );
}

export function RemoveAdminButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("admin.admins.remove");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await removeAdmin(userId).catch(() => ({ ok: false }) as const);
      if (!result.ok) return setFailed(true);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title={t("title")}
        description={t("description", { name })}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={pending}
        error={failed ? t("failed") : null}
        onConfirm={confirm}
      />
    </>
  );
}
