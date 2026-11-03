"use client";

import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionsEditor } from "../permissions-editor";
import { useSaveWorkerGrants, useWorkerGrants } from "../queries";
import type { DashboardViewer, DashboardWorker } from "./types";

/**
 * What the person may do. The owner switches it, every switch saving at once
 * (the worker's app follows without signing out, the database at the next
 * query); the person sees their own rights without switches.
 */
export function RightsTab({
  worker,
  viewer,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
}) {
  const t = useTranslations("workers.permissions");
  const owner = viewer === "owner";
  const grants = useWorkerGrants(worker.id, owner || viewer === "self");
  const save = useSaveWorkerGrants(worker.id);
  const ended = worker.status === "inactive";

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3" data-testid="worker-rights">
      {ended && <p className="text-sm text-ink-muted">{t("endedHint")}</p>}
      {grants.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !grants.data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <PermissionsEditor
          value={grants.data}
          readOnly={!owner}
          disabled={ended}
          onChange={(next, template) => save.mutate({ grants: next, template })}
          hint={owner ? t("liveHint") : t("ownHint")}
        />
      )}
      {save.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
    </GlowCard>
  );
}
