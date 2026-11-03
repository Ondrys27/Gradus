"use client";

import { createViewPreference } from "@/lib/view-preference";

export type TaskView = "list" | "map";

/**
 * List or map in the milestone detail. A per-device convenience, so it lives in
 * localStorage; when storage is unavailable the list is shown.
 */
export const useTaskView = createViewPreference<TaskView>(
  "gradus.milestones.taskView",
  ["list", "map"],
  "list",
);
