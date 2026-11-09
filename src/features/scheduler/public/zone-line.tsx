"use client";

import { useState } from "react";
import { GlobeIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { TimeZonePicker } from "@/features/settings/time-zone-picker";
import { formatUtcOffset } from "@/lib/format";

/**
 * The zone the times are shown in, as one quiet line under them (24.5):
 * "Times in Europe/Prague · UTC+1 · Change". Change opens the picker in
 * place; it was the loudest thing on the page before.
 */
export function ZoneLine({ id, zone, onChange }: { id: string; zone: string; onChange: (zone: string) => void }) {
  const t = useTranslations("booking.calendar");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <GlobeIcon aria-hidden className="size-3.5" />
        <span>{t("zoneLine", { zone: `${zone} · ${formatUtcOffset(zone)}` })}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-picker`}
          onClick={() => setOpen((value) => !value)}
          className="min-h-11 cursor-pointer rounded-md px-1 font-semibold text-teal outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-6"
        >
          {t(open ? "zoneDone" : "changeZone")}
        </button>
      </div>
      {open && (
        <div id={`${id}-picker`} className="w-full sm:w-80">
          <label htmlFor={id} className="sr-only">
            {t("zone")}
          </label>
          <TimeZonePicker id={id} value={zone} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
