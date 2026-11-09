"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, MapPinIcon, PhoneIcon, TextIcon, VideoIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { PLAN_PATH } from "@/lib/routes";
import type { LinkSource } from "../analytics";
import { bookingUrl } from "../handle";
import type { LocationKind } from "../types";

/** Where links point: the configured site, or this one while it is not set. */
export function clientOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
}

export function bookingLink(handle: string, slug?: string): string {
  return bookingUrl(clientOrigin(), handle, slug);
}

export const LOCATION_ICONS: Record<LocationKind, typeof VideoIcon> = {
  video: VideoIcon,
  phone: PhoneIcon,
  in_person: MapPinIcon,
  custom: TextIcon,
};

/** Copies the public link of a meeting type (or of the person) and says so for a moment. */
export function CopyLinkButton({
  handle,
  slug,
  from,
  variant = "outline",
  size = "sm",
  label,
}: {
  handle: string;
  slug?: string;
  from: LinkSource;
  variant?: "outline" | "secondary" | "ghost" | "default";
  size?: "sm" | "default";
  label?: string;
}) {
  const t = useTranslations("scheduler");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard
          ?.writeText(bookingLink(handle, slug))
          .then(() => {
            setCopied(true);
            track("scheduler_link_copied", { from });
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? t("link.copied") : (label ?? t("link.copy"))}
    </Button>
  );
}

/** "Solo holds one active meeting type": with the way to more for the owner. */
export function PlanLimitNotice({ limit }: { limit: number | null }) {
  const t = useTranslations("scheduler.planLimit");
  const workspace = useWorkspace();
  return (
    <FormAlert>
      <span className="flex flex-col gap-2">
        <span>{t("text", { count: limit ?? 1 })}</span>
        {workspace.role === "owner" ? (
          <Link
            href={PLAN_PATH}
            className="font-semibold text-violet underline-offset-4 hover:underline"
          >
            {t("upgrade")}
          </Link>
        ) : (
          <span>{t("worker")}</span>
        )}
      </span>
    </FormAlert>
  );
}

/** "30 min", "1 h 30 min": the length of a meeting in the interface's words. */
export function useDurationText() {
  const t = useTranslations("scheduler.duration");
  return (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return t("minutes", { minutes: rest });
    if (!rest) return t("hours", { hours });
    return t("hoursMinutes", { hours, minutes: rest });
  };
}

/** "1 day before", "2 hours before", "15 minutes before". */
export function useOffsetText() {
  const t = useTranslations("scheduler.reminders");
  return (minutes: number) => {
    if (minutes % 1440 === 0) return t("daysBefore", { count: minutes / 1440 });
    if (minutes % 60 === 0) return t("hoursBefore", { count: minutes / 60 });
    return t("minutesBefore", { count: minutes });
  };
}
