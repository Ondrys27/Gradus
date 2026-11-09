"use client";

import { ClockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { toneFill } from "@/components/ui/tone";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { EventType } from "../types";
import { CopyLinkButton, LOCATION_ICONS, useDurationText } from "./common";

/**
 * A meeting type in the list: name, length, place, bookings of the last 30
 * days, the link to copy and the on/off switch. Clicking the card opens the
 * editor.
 */
export function EventTypeCard({
  type,
  handle,
  bookings,
  canToggle,
  toggling,
  onToggle,
  onOpen,
  /** Turning it on is not offered (somebody else's type, seen by the space's owner). */
  offOnly = false,
}: {
  type: EventType;
  handle: string;
  bookings: number;
  canToggle: boolean;
  toggling: boolean;
  onToggle: (active: boolean) => void;
  onOpen?: () => void;
  offOnly?: boolean;
}) {
  const t = useTranslations("scheduler.card");
  const tLocations = useTranslations("scheduler.editor.locations");
  const settings = useFormatSettings();
  const durationText = useDurationText();
  const Icon = LOCATION_ICONS[type.location_kind];
  const place =
    type.location_kind === "video"
      ? tLocations("video")
      : (type.location_text ?? tLocations(type.location_kind));

  return (
    <article
      data-testid="event-type-card"
      className={cn(
        "relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-5 transition-colors",
        onOpen && "hover:border-line-strong",
        !type.active && "opacity-70",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", toneFill[type.color])} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="cursor-pointer text-left text-base font-semibold text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
            >
              {type.name}
            </button>
          ) : (
            <h3 className="text-base font-semibold text-ink">{type.name}</h3>
          )}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon aria-hidden className="size-4" />
              {durationText(type.duration_min)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{place}</span>
            </span>
          </p>
        </div>
        {canToggle && (
          <div className="relative z-10">
            <Switch
              checked={type.active}
              disabled={toggling || (offOnly && !type.active)}
              aria-label={
                type.active
                  ? t("deactivate", { name: type.name })
                  : t("activate", { name: type.name })
              }
              onCheckedChange={(checked) => onToggle(checked)}
            />
          </div>
        )}
      </div>
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">
          {type.active
            ? t("bookings", { count: bookings, formatted: formatNumber(bookings, {}, settings) })
            : t("inactive")}
        </span>
        <CopyLinkButton handle={handle} slug={type.slug} from="card" />
      </div>
    </article>
  );
}
