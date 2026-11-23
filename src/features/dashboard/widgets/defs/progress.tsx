"use client";

import Link from "next/link";
import { FlagIcon, FlameIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useGameState } from "@/features/game/queries";
import { levelProgress, tierForLevel } from "@/features/game/rules";
import { useMilestones } from "@/features/milestones/queries";
import type { MilestoneWithCounts } from "@/features/milestones/types";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { combine, defineWidget, Empty, Figure, Hint, type WidgetQuery } from "../kit";

// ---------------------------------------------------------------------------
// Milestones and progress: progress = done / all tasks, computed, never stored
// ---------------------------------------------------------------------------

type MilestonesData = { active: MilestoneWithCounts[]; completed: number };

function useMilestonesData(): WidgetQuery<MilestonesData> {
  const milestones = useMilestones();
  return combine([milestones], () => ({
    active: (milestones.data ?? []).filter((milestone) => milestone.status === "active"),
    completed: (milestones.data ?? []).filter((milestone) => milestone.status === "completed")
      .length,
  }));
}

function MilestoneLine({ milestone }: { milestone: MilestoneWithCounts }) {
  const t = useTranslations("dashboard.widgets.milestones");
  const format = useFormatSettings();
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <Link
        href={`/app/milniky/${milestone.id}`}
        className="flex items-center justify-between gap-2 text-sm text-ink outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <span className="truncate">{milestone.title}</span>
        <span className="shrink-0 text-xs text-ink-muted tabular-nums">
          {t("tasks", {
            done: formatNumber(milestone.done, {}, format),
            total: formatNumber(milestone.total, {}, format),
          })}
        </span>
      </Link>
      <ProgressBar
        value={milestone.done}
        max={Math.max(milestone.total, 1)}
        label={milestone.title}
        size="sm"
      />
    </li>
  );
}

export const milestonesWidget = defineWidget<MilestonesData>({
  key: "milestones",
  useData: useMilestonesData,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.milestones");
    const format = useFormatSettings();
    if (data.active.length === 0) {
      return (
        <Empty
          icon={FlagIcon}
          tone="gold"
          title={t("emptyTitle")}
          hint={size === "S" ? undefined : t("emptyHint")}
          action={
            size === "S" ? undefined : { label: t("add"), href: "/app/milniky?new=milestone" }
          }
          compact={size !== "L"}
        />
      );
    }
    const first = data.active[0];
    if (size === "S") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <ProgressRing
            value={first.done}
            max={Math.max(first.total, 1)}
            label={first.title}
            size={72}
            tone="gold"
          >
            <span className="text-sm font-bold text-ink tabular-nums">
              {formatNumber(
                first.total ? first.done / first.total : 0,
                { style: "percent" },
                format,
              )}
            </span>
          </ProgressRing>
          <span className="line-clamp-1 text-xs text-ink-soft">{first.title}</span>
        </div>
      );
    }
    return (
      <ul className="flex min-h-0 flex-col divide-y divide-line overflow-hidden">
        {data.active.slice(0, size === "L" ? 4 : 1).map((milestone) => (
          <MilestoneLine key={milestone.id} milestone={milestone} />
        ))}
        {size === "M" && data.active.length > 1 && (
          <li className="pt-1.5">
            <Hint>{t("more", { count: data.active.length - 1 })}</Hint>
          </li>
        )}
      </ul>
    );
  },
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.milestones");
    const format = useFormatSettings();
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Figure label={t("active")} value={formatNumber(data.active.length, {}, format)} />
          <Figure
            label={t("completed")}
            value={formatNumber(data.completed, {}, format)}
            className="text-green"
          />
        </div>
        {data.active.length === 0 ? (
          <Empty
            icon={FlagIcon}
            tone="gold"
            title={t("emptyTitle")}
            hint={t("emptyHint")}
            action={{ label: t("add"), href: "/app/milniky?new=milestone" }}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.active.map((milestone) => (
              <MilestoneLine key={milestone.id} milestone={milestone} />
            ))}
          </ul>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// Level and streak (game mode): computed from the total XP, never stored
// ---------------------------------------------------------------------------

type LevelData = { totalXp: number; streak: number; freeze: boolean };

function useLevel(): WidgetQuery<LevelData> {
  const game = useGameState();
  return combine([game], () => ({
    totalXp: game.data!.totalXp,
    streak: game.data!.streak,
    freeze: game.data!.streakFreezeAvailable,
  }));
}

function LevelBody({ size, data }: { size: string; data: LevelData }) {
  const t = useTranslations("dashboard.widgets.level");
  const tGame = useTranslations("game");
  const format = useFormatSettings();
  const progress = levelProgress(data.totalXp);
  const ring = (
    <ProgressRing
      value={Math.round(progress.ratio * 100)}
      label={t("progress")}
      size={size === "S" ? 72 : 84}
      tone="teal"
    >
      <span className="flex flex-col items-center leading-none">
        <span className="text-2xl font-black text-ink tabular-nums">
          {formatNumber(progress.level, {}, format)}
        </span>
        <span className="text-[10px] text-ink-muted uppercase">{t("level")}</span>
      </span>
    </ProgressRing>
  );
  if (size === "S") {
    return <div className="flex flex-1 items-center justify-center">{ring}</div>;
  }
  return (
    <div className="flex items-center gap-4">
      {ring}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-base font-bold text-ink">
          {tGame(`tiers.${tierForLevel(progress.level)}`)}
        </span>
        <span className="text-xs text-ink-muted tabular-nums">
          {progress.xpForNextLevel > 0
            ? t("toNext", {
                xp: formatNumber(progress.xpForNextLevel - progress.xpIntoLevel, {}, format),
              })
            : t("top")}
        </span>
        <span className="flex items-center gap-1 text-sm text-gold">
          <FlameIcon aria-hidden className="size-4" />
          {t("streak", { count: data.streak, formatted: formatNumber(data.streak, {}, format) })}
        </span>
      </div>
    </div>
  );
}

export const levelWidget = defineWidget<LevelData>({
  key: "level",
  useData: useLevel,
  View: LevelBody,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.level");
    const format = useFormatSettings();
    return (
      <div className="flex flex-col gap-4">
        <LevelBody size="M" data={data} />
        <div className="grid grid-cols-2 gap-3">
          <Figure label={t("totalXp")} value={formatNumber(data.totalXp, {}, format)} />
          <Figure label={t("freeze")} value={data.freeze ? t("freezeReady") : t("freezeUsed")} />
        </div>
      </div>
    );
  },
});
