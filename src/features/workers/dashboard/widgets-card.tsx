"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { grantableWidgets } from "@/features/dashboard/widgets/access";
import {
  useSaveWorkerWidgetList,
  useWorkerWidgetList,
} from "@/features/dashboard/widgets/layout-queries";
import { workerWidgetAccess } from "@/features/dashboard/widgets/worker-access";
import { track } from "@/lib/analytics/client";
import type { PermissionGrants } from "../permissions-catalog";

/**
 * Rights → "Widgets on the dashboard" (28.5, owner only): which widgets the
 * worker may use. By default all they have data for; switched off, the owner
 * ticks them one by one. Only widgets the rights give data to are listed: the
 * data stays guarded by the rights themselves.
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
  const tWidgets = useTranslations("dashboard.widgets");
  const list = useWorkerWidgetList(workerId, true);
  const save = useSaveWorkerWidgetList(workerId);
  const grantable = useMemo(() => grantableWidgets(workerWidgetAccess(grants)), [grants]);
  const all = list.data === null;
  const chosen = list.data ?? grantable.map((meta) => meta.key);

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
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-ink">
            {t("all")}
            <Switch
              checked={all}
              disabled={disabled}
              onCheckedChange={(checked) =>
                change(checked ? null : grantable.map((meta) => meta.key))
              }
              data-testid="worker-widgets-all"
            />
          </label>
          {!all && (
            <ul className="grid gap-1 sm:grid-cols-2">
              {grantable.map((meta) => {
                const checked = chosen.includes(meta.key);
                return (
                  <li key={meta.key}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-ink mouse:min-h-9">
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        data-testid={`worker-widget-${meta.key}`}
                        onCheckedChange={(next) =>
                          change(
                            next
                              ? grantable
                                  .map((entry) => entry.key)
                                  .filter((key) => key === meta.key || chosen.includes(key))
                              : chosen.filter((key) => key !== meta.key),
                          )
                        }
                      />
                      {tWidgets(`${meta.key}.name` as "today.name")}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {save.isError && <FormAlert>{t("saveFailed")}</FormAlert>}
        </>
      )}
    </GlowCard>
  );
}
