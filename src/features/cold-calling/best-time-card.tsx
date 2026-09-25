"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserSettings } from "@/features/account/queries";
import {
  countryName,
  formatIsoTime,
  formatNumber,
  weekdayName,
  weekdayShortName,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  buildHeatmap,
  HOURS,
  MIN_CELL_ATTEMPTS,
  MIN_COUNTRY_ATTEMPTS,
  type Cell,
  type StatRow,
} from "./heatmap-logic";

/** Hours labelled under the grid; the rest stay unlabelled to keep it calm. */
const LABELLED_HOURS = new Set([7, 10, 13, 16, 19]);

function useCallTimeStats(country: string | null) {
  return useQuery({
    queryKey: ["call-time-stats", country],
    enabled: country !== null,
    // Rebuilt once a day.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<StatRow[]> => {
      const { data, error } = await createClient()
        .from("call_time_stats")
        .select("day_of_week, hour, attempts, meetings")
        .eq("country_code", country ?? "")
        .limit(24 * 7);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * When calls in the user's country end in meetings: weekday × hour, one hue
 * getting stronger with the meeting share. Only real data from all users,
 * rebuilt nightly; thin cells and thin countries say so instead of guessing.
 */
export function BestTimeCard() {
  const t = useTranslations("coldCalling.bestTime");
  const locale = useLocale();
  const settings = useFormatSettings();
  const country = useUserSettings().country_code;
  const stats = useCallTimeStats(country);
  const map = useMemo(() => buildHeatmap(stats.data ?? []), [stats.data]);
  const [picked, setPicked] = useState<Cell | null>(null);
  const n = (value: number) => formatNumber(value, {}, settings);
  const percent = (value: number) =>
    formatNumber(value, { style: "percent", decimals: 0 }, settings);

  function describe(cell: Cell) {
    const when = t("when", {
      day: weekdayName(cell.day, locale),
      time: formatIsoTime(`${String(cell.hour).padStart(2, "0")}:00`, settings),
    });
    return cell.share === null
      ? t("cellFew", { when, attempts: n(cell.attempts) })
      : t("cell", { when, share: percent(cell.share), attempts: n(cell.attempts) });
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="micro-label">{t("title")}</h2>
        {country && stats.data && (
          <p className="text-xs text-ink-muted">
            {t("source", { attempts: n(map.totalAttempts), country: countryName(country, locale) })}
          </p>
        )}
      </div>

      {!country ? (
        <p className="text-sm text-ink-soft">
          {t.rich("noCountry", {
            link: (chunks) => (
              <Link href="/settings" className="text-violet underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : stats.isPending ? (
        <Skeleton className="h-56 rounded-xl" />
      ) : stats.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !map.enough ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-ink-soft">
          {t("notEnough", {
            country: countryName(country, locale),
            attempts: n(map.totalAttempts),
            needed: n(MIN_COUNTRY_ATTEMPTS),
          })}
        </p>
      ) : (
        <>
          <div aria-hidden className="grid grid-cols-[auto_repeat(14,minmax(0,1fr))] gap-0.5">
            {map.rows.map((row) => (
              <div key={row.day} className="contents">
                <span className="pr-1.5 text-right text-[11px] leading-5 text-ink-muted">
                  {weekdayShortName(row.day, locale)}
                </span>
                {row.cells.map((cell) => (
                  <span
                    key={cell.hour}
                    onPointerEnter={() => setPicked(cell)}
                    onClick={() => setPicked(cell)}
                    className={cn(
                      "h-5 rounded-[3px]",
                      picked?.day === cell.day && picked.hour === cell.hour && "ring-2 ring-ink",
                    )}
                    style={
                      cell.level === null
                        ? {
                            background:
                              "repeating-linear-gradient(135deg, var(--color-surface-hover) 0 3px, var(--color-line) 3px 4px)",
                          }
                        : {
                            background: `color-mix(in oklab, var(--color-teal) ${Math.round(12 + cell.level * 88)}%, var(--color-surface))`,
                          }
                    }
                  />
                ))}
              </div>
            ))}
            <span />
            {HOURS.map((hour) => (
              <span key={hour} className="text-center text-[10px] text-ink-muted">
                {LABELLED_HOURS.has(hour) ? n(hour) : ""}
              </span>
            ))}
          </div>

          <p className="min-h-5 text-xs text-ink-soft" aria-live="polite">
            {picked ? describe(picked) : t("hint")}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
            <span className="flex items-center gap-2">
              {t("less")}
              <span
                aria-hidden
                className="h-2.5 w-20 rounded-full"
                style={{
                  background:
                    "linear-gradient(to right, color-mix(in oklab, var(--color-teal) 12%, var(--color-surface)), var(--color-teal))",
                }}
              />
              {t("more")}
            </span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 rounded-[3px]"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, var(--color-surface-hover) 0 3px, var(--color-line) 3px 4px)",
                }}
              />
              {t("fewData", { min: n(MIN_CELL_ATTEMPTS) })}
            </span>
          </div>

          <table className="sr-only">
            <caption>{t("title")}</caption>
            <tbody>
              {map.rows.flatMap((row) =>
                row.cells
                  .filter((cell) => cell.attempts > 0)
                  .map((cell) => (
                    <tr key={`${cell.day}:${cell.hour}`}>
                      <td>{describe(cell)}</td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </>
      )}
    </GlowCard>
  );
}
