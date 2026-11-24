"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { APP_NAME } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useEventLink } from "./queries";

/**
 * In an event's detail (28.10): which calendar it is mirrored with, and when
 * both sides changed it at once, which change won (the other side was
 * overwritten).
 */
export function EventSyncNote({ eventId }: { eventId: string }) {
  const t = useTranslations("calendar.sync");
  const settings = useFormatSettings();
  const link = useEventLink(eventId).data;
  if (!link) return null;
  const provider = t(`providers.${link.provider}`);
  return (
    <div className="flex flex-col gap-2" data-testid="event-sync-note">
      <StatusPill tone="neutral" className="self-start">
        <RefreshCwIcon aria-hidden className="size-3.5" />
        {link.origin === "external" ? t("from", { provider }) : t("to", { provider })}
      </StatusPill>
      {link.conflictAt && link.conflictWinner && (
        <p
          role="note"
          className="rounded-xl border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-ink"
          data-testid="event-sync-conflict"
        >
          {t(link.conflictWinner === "external" ? "conflictExternal" : "conflictGradus", {
            provider,
            appName: APP_NAME,
            at: formatDateTime(new Date(link.conflictAt), settings),
          })}
        </p>
      )}
    </div>
  );
}
