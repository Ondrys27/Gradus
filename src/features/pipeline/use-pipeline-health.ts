"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useMinuteClock } from "@/features/crm-tasks/use-task-dialogs";
import { useFormatSettings } from "@/lib/use-format-settings";
import { pipelineHealth, type PipelineHealth } from "./health";
import { useDealTaskSignals, useDeals } from "./queries";

/**
 * The three tiles of the pipeline, from the board's deals and the open tasks
 * of deals. A worker counts only what is theirs. Fixing a deal in its detail
 * updates the board, and every task change reads the tasks again, so the
 * numbers follow without a reload; the clock turns a task overdue on its own.
 */
export function usePipelineHealth(): {
  health: PipelineHealth | null;
  pending: boolean;
  failed: boolean;
  retry: () => void;
} {
  const { user } = useSession();
  const workspace = useWorkspace();
  const settings = useFormatSettings();
  const now = useMinuteClock();
  const deals = useDeals();
  const signals = useDealTaskSignals();
  const assigneeId = workspace.role === "worker" ? user.id : null;

  const health = useMemo(
    () =>
      deals.data && signals.data
        ? pipelineHealth({
            deals: deals.data,
            tasks: signals.data.tasks,
            lastDone: signals.data.lastDone,
            assigneeId,
            now,
            settings,
          })
        : null,
    [deals.data, signals.data, assigneeId, now, settings],
  );

  return {
    health,
    pending: deals.isPending || signals.isPending,
    failed: deals.isError || signals.isError,
    retry: () => {
      void deals.refetch();
      void signals.refetch();
    },
  };
}
