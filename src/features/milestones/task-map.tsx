"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { TreeMap } from "@/components/tree-map/tree-map";
import { toBranch } from "./task-map-layout";
import { TaskMapNode, TaskMapRoot } from "./task-map-node";
import { TaskStateLegend } from "./task-status-ui";
import { buildTree } from "./task-tree";
import type { Milestone, Task } from "./types";

type Props = {
  milestone: Milestone;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onAddChild: (parent: Task | null) => void;
  /** Without the right to edit milestones: look only. */
  readOnly?: boolean;
};

const noop = () => {};

/** Tasks as a horizontal tree: the milestone is the root, tasks the branches, subtasks the leaves. */
export function TaskMap({
  milestone,
  tasks,
  onOpen,
  onToggleDone,
  onAddChild,
  readOnly = false,
}: Props) {
  const t = useTranslations("milestones.map");
  const tree = useMemo(() => toBranch(milestone.id, buildTree(tasks)), [milestone.id, tasks]);

  const { taskById, openChildren } = useMemo(() => {
    const openChildren = new Map<string, number>();
    for (const task of tasks) {
      if (task.parent_task_id && task.status !== "done") {
        openChildren.set(task.parent_task_id, (openChildren.get(task.parent_task_id) ?? 0) + 1);
      }
    }
    return { taskById: new Map(tasks.map((task) => [task.id, task])), openChildren };
  }, [tasks]);

  const doneCount = tasks.filter((task) => task.status === "done").length;

  return (
    <TreeMap
      tree={tree}
      label={t("label")}
      contentKey={`${milestone.title}|${milestone.status}`}
      overlay={<TaskStateLegend />}
      renderNode={(id, node) => {
        const task = taskById.get(id);
        if (!task) {
          return (
            <TaskMapRoot
              title={milestone.title}
              done={doneCount}
              total={tasks.length}
              completed={milestone.status === "completed"}
              onAddChild={readOnly ? undefined : node.measuring ? noop : () => onAddChild(null)}
            />
          );
        }
        return (
          <TaskMapNode
            task={task}
            remaining={openChildren.get(id) ?? 0}
            childCount={node.childCount}
            hiddenCount={node.hiddenCount}
            collapsed={node.collapsed}
            onOpen={node.measuring || readOnly ? noop : () => onOpen(task)}
            onToggleDone={node.measuring || readOnly ? noop : () => onToggleDone(task)}
            onAddChild={readOnly ? undefined : node.measuring ? noop : () => onAddChild(task)}
            readOnly={readOnly}
            onToggleCollapsed={node.onToggleCollapsed}
          />
        );
      }}
    />
  );
}
