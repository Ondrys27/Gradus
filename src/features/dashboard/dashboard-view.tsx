"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { useProfile } from "@/features/account/queries";
import { formatList, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { daySummaryParts, greetingPart } from "./dashboard-logic";
import { TileDetail } from "./tile-detail";
import {
  ActiveDealsTile,
  IncomeTile,
  NewContactsTile,
  ProspectingTile,
  TasksTile,
  WinRateTile,
  type TileKey,
} from "./tiles";
import { TodayCard, useTodayOverview } from "./today-card";

export function DashboardView() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const settings = useFormatSettings();
  const profile = useProfile();
  const overview = useTodayOverview();
  const [openTile, setOpenTile] = useState<TileKey | null>(null);

  const name = (profile.display_name || profile.username || "").trim();
  const greeting = t(`greeting.${greetingPart(new Date(), settings.timeZone)}`, {
    hasName: name ? "yes" : "no",
    name,
  });

  const parts = daySummaryParts(overview.counts);
  const summary =
    parts.length === 0
      ? t("summary.empty")
      : t("summary.lead", {
          list: formatList(
            parts.map(({ part, count }) =>
              t(`summary.${part}`, { count, formatted: formatNumber(count, {}, settings) }),
            ),
            locale,
          ),
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="page-title text-balance">{greeting}</h1>
        <div className="min-h-6 max-w-2xl text-base text-ink-soft" aria-live="polite">
          {overview.pending ? <Skeleton className="h-6 w-72 max-w-full" /> : summary}
        </div>
      </header>

      <Stagger className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* On a phone what to do today comes first; on a wide screen it is the right-hand card. */}
        <StaggerItem className="lg:order-last">
          <TodayCard overview={overview} />
        </StaggerItem>
        <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 xl:grid-cols-3">
          <StaggerItem className="h-full min-w-0">
            <IncomeTile onOpen={() => setOpenTile("income")} />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <TasksTile onOpen={() => setOpenTile("tasks")} />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <WinRateTile onOpen={() => setOpenTile("winRate")} />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <ActiveDealsTile onOpen={() => setOpenTile("activeDeals")} />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <NewContactsTile onOpen={() => setOpenTile("newContacts")} />
          </StaggerItem>
          <StaggerItem className="h-full min-w-0">
            <ProspectingTile onOpen={() => setOpenTile("prospecting")} />
          </StaggerItem>
        </div>
      </Stagger>

      <AnimatePresence>
        {openTile && (
          <TileDetail key={openTile} tile={openTile} onClose={() => setOpenTile(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
