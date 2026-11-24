"use client";

import { FlagIcon, FlameIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toneText, type Tone } from "@/components/ui/tone";
import { useGameState } from "@/features/game/queries";
import { levelProgress, tierForLevel } from "@/features/game/rules";
import { useMilestones } from "@/features/milestones/queries";
import type { MilestoneWithCounts } from "@/features/milestones/types";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  Bar,
  combine,
  defineWidget,
  Empty,
  Figure,
  LiveNumber,
  Ring,
  Side,
  Stack,
  Sub,
  type WidgetQuery,
} from "@/features/widgets/kit";

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

function ratioOf(milestone: MilestoneWithCounts) {
  return milestone.total > 0 ? milestone.done / milestone.total : 0;
}

/** The bars of the milestones: name, done of total, and the bar as that ratio. */
function MilestoneBars({
  milestones,
  tone,
}: {
  milestones: MilestoneWithCounts[];
  tone: Tone;
}) {
  const t = useTranslations("dashboard.widgets.milestones");
  const format = useFormatSettings();
  return (
    <ul className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
      {milestones.map((milestone) => (
        <Bar
          key={milestone.id}
          href={`/app/milniky/${milestone.id}`}
          label={milestone.title}
          tone={tone}
          ratio={ratioOf(milestone)}
          value={t("tasks", {
            done: formatNumber(milestone.done, {}, format),
            total: formatNumber(milestone.total, {}, format),
          })}
        />
      ))}
    </ul>
  );
}

function MilestonesEmpty({ compact }: { compact: boolean }) {
  const t = useTranslations("dashboard.widgets.milestones");
  return (
    <Empty
      icon={FlagIcon}
      tone="gold"
      title={t("emptyTitle")}
      hint={t("emptyHint")}
      action={{ label: t("add"), href: "/app/milniky?new=milestone" }}
      compact={compact}
    />
  );
}

export const milestonesWidget = defineWidget<MilestonesData>({
  key: "milestones",
  useData: useMilestonesData,
  View: ({ size, data, tone }) => {
    const t = useTranslations("dashboard.widgets.milestones");
    const format = useFormatSettings();
    if (data.active.length === 0) return <MilestonesEmpty compact={size !== "L"} />;
    const first = data.active[0];
    if (size === "S") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <Ring value={first.done} max={first.total} tone={tone} label={first.title} size={64}>
            <span className="text-sm font-bold text-ink">
              <LiveNumber value={ratioOf(first)} format={{ style: "percent" }} />
            </span>
          </Ring>
          <span className="line-clamp-1 w-full text-center text-xs text-ink-soft">
            {first.title}
          </span>
        </div>
      );
    }
    if (size === "M") return <MilestoneBars milestones={data.active.slice(0, 2)} tone={tone} />;
    return (
      <Stack between>
        <MilestoneBars milestones={data.active.slice(0, 4)} tone={tone} />
        <Sub className="text-xs text-ink-muted">
          {t("doneCount", { count: formatNumber(data.completed, {}, format) })}
        </Sub>
      </Stack>
    );
  },
  Detail: ({ data, tone }) => {
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
          <MilestonesEmpty compact={false} />
        ) : (
          <MilestoneBars milestones={data.active} tone={tone} />
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

function LevelRing({ data, tone, size }: { data: LevelData; tone: Tone; size: number }) {
  const t = useTranslations("dashboard.widgets.level");
  const format = useFormatSettings();
  const progress = levelProgress(data.totalXp);
  return (
    <Ring
      value={Math.round(progress.ratio * 100)}
      max={100}
      tone={tone}
      size={size}
      label={t("progress")}
    >
      <span className="flex flex-col items-center leading-none">
        <span
          className={cn("font-black text-ink tabular-nums", size >= 80 ? "text-2xl" : "text-xl")}
        >
          {formatNumber(progress.level, {}, format)}
        </span>
        <span className="text-[10px] text-ink-muted uppercase">{t("level")}</span>
      </span>
    </Ring>
  );
}

function LevelBody({ size, data, tone }: { size: string; data: LevelData; tone: Tone }) {
  const t = useTranslations("dashboard.widgets.level");
  const tGame = useTranslations("game");
  const format = useFormatSettings();
  const progress = levelProgress(data.totalXp);
  if (size === "S") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LevelRing data={data} tone={tone} size={72} />
      </div>
    );
  }
  return (
    <Side aside={<LevelRing data={data} tone={tone} size={72} />}>
      <span className="truncate text-base font-bold text-ink">
        {tGame(`tiers.${tierForLevel(progress.level)}`)}
      </span>
      <Sub className="text-xs text-ink-muted">
        {progress.xpForNextLevel > 0
          ? t("toNext", {
              xp: formatNumber(progress.xpForNextLevel - progress.xpIntoLevel, {}, format),
            })
          : t("top")}
      </Sub>
      <span className={cn("flex items-center gap-1 text-sm tabular-nums", toneText[tone])}>
        <FlameIcon aria-hidden className="size-4 shrink-0" />
        <span className="truncate">
          {t("streak", { count: data.streak, formatted: formatNumber(data.streak, {}, format) })}
        </span>
      </span>
    </Side>
  );
}

export const levelWidget = defineWidget<LevelData>({
  key: "level",
  useData: useLevel,
  View: LevelBody,
  Detail: ({ data, tone }) => {
    const t = useTranslations("dashboard.widgets.level");
    const format = useFormatSettings();
    return (
      <div className="flex flex-col gap-4">
        <LevelBody size="M" data={data} tone={tone} />
        <div className="grid grid-cols-2 gap-3">
          <Figure label={t("totalXp")} value={formatNumber(data.totalXp, {}, format)} />
          <Figure label={t("freeze")} value={data.freeze ? t("freezeReady") : t("freezeUsed")} />
        </div>
      </div>
    );
  },
});
