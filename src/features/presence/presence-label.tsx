"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PresenceDot, usePresenceOf, type PersonPresence } from "@/components/ui/presence";
import { lastSeenWhen, type LastSeenWhen } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";

/** "naposledy před 5 hodinami": the words of the translations, the date from format.ts. */
export function useLastSeenText() {
  const t = useTranslations("presence.lastSeen");
  return (when: LastSeenWhen): string => {
    switch (when.kind) {
      case "moment":
        return t("moment");
      case "minutes":
        return t("minutes", { count: when.count });
      case "hours":
        return t("hours", { count: when.count });
      case "yesterday":
        return t("yesterday");
      case "weekday":
        return t(`weekday.${when.day}` as never);
      case "date":
        return t("date", { date: when.date });
    }
  };
}

/** The relative time moves on by itself, once a minute is enough. */
function useMinuteClock(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function presenceText(
  presence: PersonPresence,
  t: (key: "online" | "away") => string,
  lastSeen: (when: LastSeenWhen) => string,
  now: Date,
  settings: Parameters<typeof lastSeenWhen>[2],
): string | null {
  if (presence.status !== "offline") return t(presence.status);
  if (!presence.lastSeenAt) return null;
  return lastSeen(lastSeenWhen(new Date(presence.lastSeenAt), now, settings));
}

/** The words for a person's status now, or null when there is nothing to show. */
export function usePresenceText(
  userId: string | null | undefined,
): { status: PersonPresence["status"]; text: string } | null {
  const t = useTranslations("presence");
  const lastSeen = useLastSeenText();
  const settings = useFormatSettings();
  const presence = usePresenceOf(userId);
  const now = useMinuteClock(presence?.status === "offline");
  if (!presence) return null;
  const text = presenceText(presence, (key) => t(key), lastSeen, now, settings);
  return text ? { status: presence.status, text } : null;
}

export const presenceTone = {
  online: "text-green",
  away: "text-gold",
  offline: "text-ink-muted",
} as const;

/**
 * "online" / "nepřítomen" / "naposledy před 5 hodinami" next to a person of
 * the company (their dashboard, the header of a conversation, the people of
 * the company). Nothing when there is no status to show.
 */
export function PresenceLabel({
  userId,
  className,
}: {
  userId: string | null | undefined;
  className?: string;
}) {
  const presence = usePresenceText(userId);
  if (!presence) return null;
  return (
    <span
      data-testid="presence-label"
      data-presence={presence.status}
      className={cn("truncate text-xs", presenceTone[presence.status], className)}
    >
      {presence.text}
    </span>
  );
}

/** Only the dot, in a line of text (the Team and Activity widgets); nothing offline. */
export function PresenceInline({
  userId,
  className,
}: {
  userId: string | null | undefined;
  className?: string;
}) {
  const presence = usePresenceOf(userId);
  if (!presence || presence.status === "offline") return null;
  return (
    <PresenceDot
      status={presence.status}
      className={cn("inline-block size-2 min-h-0 min-w-0 shrink-0 ring-0", className)}
    />
  );
}
