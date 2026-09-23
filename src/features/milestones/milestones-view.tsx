"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlagIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MilestoneCard } from "./milestone-card";
import { MilestoneFormDialog } from "./milestone-form-dialog";
import { useMilestones } from "./queries";
import { sortMilestones } from "./task-tree";
import type { MilestoneCategory } from "./types";

type Filter = "all" | MilestoneCategory;
const FILTERS: Filter[] = ["all", "work", "personal"];

export function MilestonesView() {
  const t = useTranslations("milestones");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const { data, isPending, isError, refetch } = useMilestones();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () => sortMilestones(data ?? []).filter((m) => filter === "all" || m.category === filter),
    [data, filter],
  );

  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden data-icon="inline-start" />
      {t("actions.new")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tNav("milestones")} description={t("description")} actions={newButton} />

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
              <Button onClick={() => setCreating(true)}>
                <PlusIcon aria-hidden data-icon="inline-start" />
                {t("empty.action")}
              </Button>
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

      <MilestoneFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(milestone) => router.push(`/milestones/${milestone.id}`)}
      />
    </div>
  );
}
