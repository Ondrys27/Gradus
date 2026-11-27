"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { systemDefault } from "@/features/dashboard/widgets/defaults";
import type { LayoutItem } from "@/features/widgets/grid";
import {
  targetMatches,
  useDashboardDefaults,
  useDeleteDashboardDefault,
  useSaveDashboardDefault,
  type DefaultTarget,
} from "@/features/dashboard/widgets/layout-queries";
import { useBoardEditor } from "@/features/widgets/use-board-editor";
import { WidgetBoard } from "@/features/widgets/widget-board";
import { useAppWidgetSystem } from "@/features/dashboard/widgets/app-system";
import { TEMPLATE_ACCESS } from "@/features/dashboard/widgets/worker-access";
import { track } from "@/lib/analytics/client";
import type { CompanyGroup, CompanyPerson } from "./tree";

const SPACE = "space";

function parseTarget(key: string): DefaultTarget {
  if (key.startsWith("group:")) return { kind: "group", groupId: key.slice(6) };
  if (key.startsWith("worker:")) return { kind: "worker", workerId: key.slice(7) };
  return { kind: "space" };
}

/**
 * Company → Dashboards (28.5, owner only): the dashboard a worker starts on,
 * set for the whole company, a group or one person (a person's beats a
 * group's, which beats the company's; without any, the system's). The same
 * editor as one's own dashboard. A worker who changed their own keeps it and
 * is only offered the new one.
 */
export function CompanyDashboards({
  people,
  groups,
  canEdit,
}: {
  people: CompanyPerson[] | undefined;
  groups: CompanyGroup[] | undefined;
  canEdit: boolean;
}) {
  const t = useTranslations("workers.company.dashboards");
  const [key, setKey] = useState(SPACE);
  const target = useMemo(() => parseTarget(key), [key]);
  const defaults = useDashboardDefaults(true);
  const saveDefault = useSaveDashboardDefault();
  const deleteDefault = useDeleteDashboardDefault();
  const stored = defaults.data?.find((row) => targetMatches(row, target)) ?? null;

  const fallback = useMemo(
    () => systemDefault({ role: "worker", playing: false, industry: "other" }),
    [],
  );
  const source = defaults.data ? (stored?.items ?? fallback) : undefined;

  // One save after another: the first change of a target makes exactly one row.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // The row of each target, so a save queued for one target never writes another's row.
  const storedIds = useRef(new Map<string, string>());
  useEffect(() => {
    if (stored?.id) storedIds.current.set(key, stored.id);
    else storedIds.current.delete(key);
  }, [stored?.id, key]);
  const save = useCallback(
    (items: LayoutItem[]) => {
      const targetKey = key;
      const run = async () => {
        const saved = await saveDefault.mutateAsync({
          target,
          existingId: storedIds.current.get(targetKey) ?? null,
          items,
        });
        storedIds.current.set(targetKey, saved.id);
        track("dashboard_default_saved", { target: target.kind, widgets: items.length });
      };
      chain.current = chain.current.catch(() => undefined).then(run);
      return chain.current;
    },
    // mutateAsync is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, key],
  );
  const editor = useBoardEditor({ source, save, boardKey: key });
  const widgetSystem = useAppWidgetSystem(TEMPLATE_ACCESS);

  const active = (people ?? []).filter((person) => person.status !== "inactive");
  const options = [
    { value: SPACE, label: t("targets.space") },
    ...(groups ?? []).map((group) => ({
      value: `group:${group.id}`,
      label: t("targets.group", { name: group.name }),
    })),
    ...active.map((person) => ({
      value: `worker:${person.id}`,
      label: t("targets.worker", { name: person.name }),
    })),
  ];
  const current = options.find((option) => option.value === key) ?? options[0];
  const label =
    target.kind === "space"
      ? t("editing.space")
      : target.kind === "group"
        ? t("editing.group", {
            name: (groups ?? []).find((group) => group.id === target.groupId)?.name ?? "",
          })
        : t("editing.worker", {
            name: active.find((person) => person.id === target.workerId)?.name ?? "",
          });

  return (
    <div className="flex flex-col gap-4" data-testid="company-dashboards" data-tutorial="company-dashboards">
      <GlowCard interactive={false} className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span id="company-dashboard-target" className="text-sm font-medium text-ink">
            {t("target")}
          </span>
          <Select
            value={current.value}
            items={options}
            onValueChange={(next) => {
              if (typeof next === "string") setKey(next);
            }}
          >
            <SelectTrigger
              aria-labelledby="company-dashboard-target"
              data-testid="company-dashboard-target"
              className="w-auto min-w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-ink-muted">{stored ? t("set") : t("notSet")}</span>
        </div>
      </GlowCard>
      {defaults.isError && <FormAlert>{t("loadFailed")}</FormAlert>}
      {canEdit ? (
        <WidgetBoard
          editor={editor}
          system={widgetSystem}
          scope={`template-${key}`}
          template={{ kind: target.kind, label }}
          onReset={
            stored
              ? () => {
                  deleteDefault.mutate(stored.id);
                  storedIds.current.delete(key);
                }
              : undefined
          }
          resetLabel={t("remove")}
        />
      ) : (
        <p className="text-sm text-ink-muted">{t("readOnly")}</p>
      )}
    </div>
  );
}
