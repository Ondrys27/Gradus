"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { grantableWidgets } from "@/features/dashboard/widgets/access";
import {
  useSaveWorkerWidgetList,
  useWorkerWidgetList,
} from "@/features/dashboard/widgets/layout-queries";
import { workerWidgetAccess } from "@/features/dashboard/widgets/worker-access";
import { track } from "@/lib/analytics/client";
import type { PermissionGrants } from "../permissions-catalog";
import { WidgetsChooser } from "./widgets-chooser";

/**
 * Rights → "Widgets on the dashboard" (28.5, owner only): which widgets the
 * worker may use, every change saved at once.
 */
export function WorkerWidgetsCard({
  workerId,
  grants,
  disabled,
}: {
  workerId: string;
  grants: PermissionGrants;
  disabled: boolean;
}) {
  const t = useTranslations("workers.permissions.widgets");
  const list = useWorkerWidgetList(workerId, true);
  const save = useSaveWorkerWidgetList(workerId);
  const grantable = useMemo(() => grantableWidgets(workerWidgetAccess(grants)), [grants]);

  function change(next: string[] | null) {
    save.mutate(next);
    track("dashboard_widgets_allowed", {
      allowed: next?.length ?? grantable.length,
      all: next === null,
    });
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3" data-testid="worker-widgets">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </div>
      {list.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : list.data === undefined ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : (
        <>
          <WidgetsChooser grants={grants} value={list.data} onChange={change} disabled={disabled} />
          {save.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
        </>
      )}
    </GlowCard>
  );
}
