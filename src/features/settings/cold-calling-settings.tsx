"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserSettings } from "@/features/account/queries";
import { sortStages } from "@/features/pipeline/board-logic";
import { openStages } from "@/features/pipeline/contact-deals";
import { useStages } from "@/features/pipeline/queries";
import type { UserSettingsPatch } from "@/lib/user-settings";

/** Stands for "no stage picked": the first open stage of the pipeline. */
const FIRST = "first";

/** The stage a deal made from Cold Calling lands in. */
export function ColdCallingDealStageSelect({
  id,
  save,
}: {
  id: string;
  save: (patch: UserSettingsPatch) => void;
}) {
  const t = useTranslations("settings.coldCalling");
  const stored = useUserSettings().cold_calling_deal_stage_id;
  const stagesQuery = useStages();
  const stages = useMemo(
    () => openStages(sortStages(stagesQuery.data ?? [])),
    [stagesQuery.data],
  );
  const items = useMemo(
    () => [
      { value: FIRST, label: t("firstStage", { name: stages[0]?.name ?? "" }) },
      ...stages.map((stage) => ({ value: stage.id, label: stage.name })),
    ],
    [stages, t],
  );

  if (stagesQuery.isPending) return <Skeleton className="h-11 rounded-xl" />;
  // A stage removed or closed since counts as none: the first one again.
  const value = stages.some((stage) => stage.id === stored) ? stored! : FIRST;

  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (typeof next !== "string" || next === value) return;
        save({ cold_calling_deal_stage_id: next === FIRST ? null : next });
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
