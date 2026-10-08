"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlagIcon, ListIcon, MapIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useUrlIntent } from "@/lib/use-url-intent";
import { cn } from "@/lib/utils";
import { useCan } from "@/features/account/workspace-queries";
import { PathMap } from "@/features/game/path-map";
import { useGameState, useIsPlaying } from "@/features/game/queries";
import { MilestoneCard } from "./milestone-card";
import { MilestoneFormDialog } from "./milestone-form-dialog";
import { useMilestones } from "./queries";
import { sortMilestones } from "./task-tree";
import type { MilestoneCategory } from "./types";
import { useViewTracking } from "@/lib/analytics/use-view-tracking";

type Filter = "all" | MilestoneCategory;
type View = "list" | "path";
const FILTERS: Filter[] = ["all", "work", "personal"];

export function MilestonesView() {
  const t = useTranslations("milestones");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const { data, isPending, isError, refetch } = useMilestones();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const canEdit = useCan("milestones", "edit");
  useUrlIntent("new", (value) => {
    if (value === "milestone" && canEdit) setCreating(true);
  });
  // The path view exists in game mode once a path is chosen.
  const playing = useIsPlaying();
  const game = useGameState();
  const hasPath = playing && !!game.data?.pathKey;
  const [view, setView] = useState<View>("list");
  useUrlIntent("view", (value) => {
    if (value === "path") setView("path");
  });
  const showPath = hasPath && view === "path";
  useViewTracking("milestones", showPath ? "path" : "list");

  const visible = useMemo(
    () => sortMilestones(data ?? []).filter((m) => filter === "all" || m.category === filter),
    [data, filter],
  );

  const newButton = canEdit && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden data-icon="inline-start" />
      {t("actions.new")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("milestones")} description={t("description")} actions={newButton} />

      {hasPath && (
        <div
          role="group"
          aria-label={t("view.label")}
          className="inline-flex self-start rounded-full border border-line bg-canvas-deep/60 p-1"
        >
          {(["list", "path"] as const).map((key) => {
            const Icon = key === "list" ? ListIcon : MapIcon;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
                  view === key
                    ? "bg-violet/20 text-ink shadow-glow"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {t(`view.${key}`)}
              </button>
            );
          })}
        </div>
      )}

      {showPath ? (
        <PathMap />
      ) : (
        <>
          <div role="group" aria-label={t("filter.label")} className="flex flex-wrap gap-2">
            {FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
                  filter === key
                    ? "border-violet/50 bg-violet/15 text-ink"
                    : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
                )}
              >
                {t(`filter.${key}`)}
              </button>
            ))}
          </div>

          {isPending ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-36 rounded-card" />
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              icon={<FlagIcon />}
              title={t("loadFailed")}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  {t("retry")}
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            data.length === 0 ? (
              <EmptyState
                icon={<FlagIcon />}
                title={t("empty.title")}
                description={t("empty.description")}
                action={
                  canEdit && (
                    <Button onClick={() => setCreating(true)}>
                      <PlusIcon aria-hidden data-icon="inline-start" />
                      {t("empty.action")}
                    </Button>
                  )
                }
              />
            ) : (
              <EmptyState
                icon={<FlagIcon />}
                title={t("empty.filteredTitle")}
                description={t("empty.filteredDescription")}
              />
            )
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {visible.map((milestone) => (
                <MilestoneCard key={milestone.id} milestone={milestone} />
              ))}
            </div>
          )}
        </>
      )}

      <MilestoneFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(milestone) => router.push(`/app/milniky/${milestone.id}`)}
      />
    </div>
  );
}
