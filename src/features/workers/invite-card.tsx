"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, MailPlusIcon, RefreshCwIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { inviteState, inviteUrl } from "./logic";
import type { WorkerInvite } from "./types";

type Props = {
  invite: WorkerInvite;
  workerName: string;
  onRenew?: () => void;
  renewing?: boolean;
  renewFailed?: boolean;
  className?: string;
};

/** Where the link points: the configured site, or this one while it is not set. */
function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
}

/** The link and code to send, with what happens next. Expired links can be renewed. */
export function InviteCard({ invite, workerName, onRenew, renewing, renewFailed, className }: Props) {
  const t = useTranslations("workers.invite");
  const settings = useFormatSettings();
  const [link, setLink] = useState("");
  const locale = useLocale();
  useEffect(() => setLink(inviteUrl(invite.code, siteOrigin(), locale)), [invite.code, locale]);
  const state = inviteState(invite, new Date());
  if (state === "accepted") return null;

  return (
    <section
      aria-label={t("title", { name: workerName })}
      className={cn("flex flex-col gap-4 rounded-card border border-teal/30 bg-teal/5 p-5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-teal/30 bg-teal/10 text-teal">
          <MailPlusIcon aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-semibold text-ink">{t("title", { name: workerName })}</h3>
          <p className="text-sm text-ink-soft">{t("howTo")}</p>
        </div>
      </div>

      {state === "expired" ? (
        <div className="flex flex-col gap-3">
          <FormAlert>{t("expired")}</FormAlert>
          {onRenew && (
            <Button variant="outline" onClick={onRenew} disabled={renewing} className="self-start">
              <RefreshCwIcon aria-hidden data-icon="inline-start" />
              {t("renew")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <CopyRow label={t("link")} value={link} />
          <CopyRow label={t("code")} value={invite.code} mono />
          <p className="text-xs text-ink-muted">
            {t("validUntil", { date: formatDate(new Date(invite.expires_at), settings) })}
          </p>
        </>
      )}
      {renewFailed && <FormAlert>{t("renewFailed")}</FormAlert>}
    </section>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const t = useTranslations("workers.invite");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked: the field is selectable, so the text can be copied by hand.
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="micro-label">{label}</span>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className={cn("min-w-0 flex-1", mono && "font-mono")}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => void copy()}
          aria-label={copied ? t("copied") : t("copy", { what: label })}
        >
          {copied ? <CheckIcon aria-hidden className="text-teal" /> : <CopyIcon aria-hidden />}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}
