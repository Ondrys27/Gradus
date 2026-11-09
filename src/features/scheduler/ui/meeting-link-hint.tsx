"use client";

import { useState } from "react";
import { CalendarClockIcon, CheckIcon, CopyIcon, MailIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useWorkspace } from "@/features/account/workspace-queries";
import { grantAllows } from "@/features/workers/permissions-catalog";
import { track } from "@/lib/analytics/client";
import type { LinkSource } from "../analytics";
import { pickEventType, type LinkPurpose } from "../event-type-form";
import { useEventTypes, useSchedulerProfile } from "../queries";
import { bookingLink, useDurationText } from "./common";

/**
 * The best booking link of the signed-in person for a purpose: a first call
 * (Cold Calling, the shortest active type) or a meeting (an e-mail, the one
 * closest to 30 minutes). Null without the scheduler, a profile or an active
 * type; nothing is fetched without the right.
 */
export function useBookingLink(purpose: LinkPurpose) {
  const workspace = useWorkspace();
  const allowed = workspace.role === "owner" || grantAllows(workspace.grants, "scheduler", "own");
  const profile = useSchedulerProfile(allowed);
  const types = useEventTypes(allowed ? (profile.data?.id ?? undefined) : undefined);
  if (!allowed || !profile.data || !types.data) return null;
  const best = pickEventType(types.data, purpose);
  if (!best) return null;
  return { type: best, url: bookingLink(profile.data.handle, best.slug) };
}

/**
 * Jarvis's quiet suggestion "send a link to book a meeting" with the best
 * type: insert it into an e-mail, copy it, or open a mail to the contact.
 */
export function MeetingLinkHint({
  purpose,
  from,
  onInsert,
  email,
}: {
  purpose: LinkPurpose;
  from: LinkSource;
  /** Puts the link into the text being written (the e-mail). */
  onInsert?: (url: string) => void;
  /** The contact's address, for a ready mail. */
  email?: string | null;
}) {
  const t = useTranslations("scheduler.hint");
  const durationText = useDurationText();
  const link = useBookingLink(purpose);
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const label = t("text", { name: link.type.name, duration: durationText(link.type.duration_min) });
  return (
    <div
      data-testid="meeting-link-hint"
      className="flex flex-col gap-2 rounded-xl border border-teal/30 bg-teal/8 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="flex items-center gap-2 text-ink-soft">
        <CalendarClockIcon aria-hidden className="size-4 shrink-0 text-teal" />
        {label}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {onInsert ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onInsert(link.url);
              track("scheduler_link_copied", { from });
            }}
          >
            <PlusIcon aria-hidden />
            {t("insert")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(link.url)
                .then(() => {
                  setCopied(true);
                  track("scheduler_link_copied", { from });
                })
                .catch(() => undefined)
            }
          >
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? t("copied") : t("copy")}
          </Button>
        )}
        {email && !onInsert && (
          <a
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(t("mailSubject"))}&body=${encodeURIComponent(t("mailBody", { url: link.url }))}`}
            onClick={() => track("scheduler_link_copied", { from })}
          >
            <MailIcon aria-hidden />
            {t("mail")}
          </a>
        )}
      </span>
    </div>
  );
}
