"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { grantableWidgets } from "@/features/dashboard/widgets/access";
import { workerWidgetAccess } from "@/features/dashboard/widgets/worker-access";
import type { PermissionGrants } from "../permissions-catalog";

/**
 * Which widgets the worker may use (28.5): all they have data for, or the
 * ones the owner ticks. The same switches on the Rights tab (saved at once)
 * and before the invite (30.2, saved with it). Only widgets the rights give
 * data to are listed: the data stays guarded by the rights themselves.
 */
export function WidgetsChooser({
  grants,
  value,
  onChange,
  disabled = false,
}: {
  grants: PermissionGrants;
  /** null = all the rights allow. */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("workers.permissions.widgets");
  const tWidgets = useTranslations("dashboard.widgets");
  const grantable = useMemo(() => grantableWidgets(workerWidgetAccess(grants)), [grants]);
  const all = value === null;
  const chosen = value ?? grantable.map((meta) => meta.key);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-ink">
        {t("all")}
        <Switch
          checked={all}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? null : grantable.map((meta) => meta.key))}
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
                      onChange(
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
    </div>
  );
}
