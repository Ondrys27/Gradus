"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useNavItems } from "@/components/layout/use-nav";
import { useCan } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import type { HealthTile } from "./health";
import { HealthTiles } from "./health-tiles";
import { usePipelineHealth } from "./use-pipeline-health";

const PIPELINE_PATH = "/app/pipeline";

/** Where a dashboard tile leads: the pipeline with that tile's list open. */
export function pipelineTileHref(tile: HealthTile): string {
  return `${PIPELINE_PATH}?tile=${tile}`;
}

/**
 * The pipeline's three tiles at the top of the dashboard. Only for an account
 * that has the pipeline (not locked in game mode, and a worker with the right
 * to see it); a worker's numbers are only their own deals and tasks.
 */
export function DashboardPipelineHealth() {
  const { items } = useNavItems();
  const canView = useCan("pipeline", "view");
  const pipeline = items.find((item) => item.key === "pipeline");
  if (!pipeline || pipeline.locked || !canView) return null;
  return <Tiles />;
}

function Tiles() {
  const t = useTranslations("pipeline.health");
  const router = useRouter();
  const { health, pending, failed, retry } = usePipelineHealth();
  return (
    <section aria-labelledby="dashboard-pipeline-health" className="flex flex-col gap-2">
      <h2 id="dashboard-pipeline-health" className="micro-label">
        {t("label")}
      </h2>
      <HealthTiles
        health={health}
        pending={pending}
        failed={failed}
        onRetry={retry}
        linksToPipeline
        onSelect={(tile) => {
          if (health)
            track("pipeline_health_opened", { tile, from: "dashboard", count: health[tile].count });
          router.push(pipelineTileHref(tile));
        }}
      />
    </section>
  );
}
