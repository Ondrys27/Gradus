"use client";

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { MindMap, type MindMapDrag } from "@/components/mindmap/mind-map";
import { toBranch } from "./task-map-layout";
import { TaskMapDragPreview, TaskMapNode, TaskMapRoot } from "./task-map-node";
import { TaskStateLegend } from "./task-status-ui";
import { buildTree, keyboardTarget, mapDropTarget, planMove, type MoveTarget } from "./task-tree";
import type { Milestone, Task } from "./types";

type Props = {
  milestone: Milestone;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onAddChild: (parent: Task | null) => void;
  /** Moves a task; absent without the right to edit milestones. */
  onMove?: (taskId: string, target: MoveTarget, via: "map" | "keyboard") => void;
  /** Without the right to edit milestones: look only. */
  readOnly?: boolean;
  /** The node drawn as selected (the milestone right after an import). */
  selectedId?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** A new value fits the whole map into view (after an import). */
  alignKey?: unknown;
  onAligned?: () => void;
  /** A file dropped onto the map: a mind map to import. */
  onFileDrop?: (file: File) => void;
};

const noop = () => {};

/**
 * Tasks as a horizontal mind map: the milestone is the root, tasks the
 * branches, subtasks the leaves. A task is dragged (on a phone after a long
 * press) onto another task to become its subtask, between tasks to change the
 * order, or onto the milestone to go to level 1; its subtree goes along.
 * ⌘/Ctrl + arrows move the focused task. The map itself (layout, zoom,
 * dragging) is the shared MindMap; the rules of a move are the tasks' own.
 */
export function TaskMap({
  milestone,
  tasks,
  onOpen,
  onToggleDone,
  onAddChild,
  onMove,
  readOnly = false,
  selectedId,
  onSelectedChange,
  alignKey,
  onAligned,
  onFileDrop,
}: Props) {
  const t = useTranslations("milestones.map");
  const tm = useTranslations("milestones.tasks.move");
  const tio = useTranslations("milestones.mapIo");
  const canMove = !readOnly && Boolean(onMove);
  const tree = useMemo(() => toBranch(milestone.id, buildTree(tasks)), [milestone.id, tasks]);
  /** A long press ends in a click; it must not open the task it just dropped. */
  const justDragged = useRef(false);

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
  const titleOf = (id: string) =>
    id === milestone.id ? milestone.title : (taskById.get(id)?.title ?? "");

  const drag: MindMapDrag<MoveTarget> | undefined = canMove
    ? {
        resolve: (activeId, overId, zone) => {
          const target = mapDropTarget(
            tasks,
            activeId,
            overId === milestone.id ? null : overId,
            zone,
          );
          if (!target) return null;
          return { target, valid: planMove(tasks, activeId, target).ok };
        },
        onDrop: (id, target) => onMove?.(id, target, "map"),
        onKeyMove: (id, direction) => {
          const target = keyboardTarget(tasks, id, direction);
          if (target) onMove?.(id, target, "keyboard");
        },
        renderPreview: (id, { below, scale }) => {
          const task = taskById.get(id);
          return task ? <TaskMapDragPreview task={task} below={below} scale={scale} /> : null;
        },
        titleOf,
        texts: {
          pickedUp: (title) => tm("pickedUp", { title }),
          over: (title, target) => tm("over", { title, target }),
          dropped: (title) => tm("dropped", { title }),
          cancelled: () => tm("cancelled"),
          instructions: tm("mapInstructions"),
        },
        justDragged,
      }
    : undefined;

  return (
    <MindMap
      tree={tree}
      label={t("label")}
      contentKey={`${milestone.title}|${milestone.status}`}
      overlay={<TaskStateLegend />}
      drag={drag}
      selectedId={selectedId}
      onSelectedChange={onSelectedChange}
      alignKey={alignKey}
      onAligned={onAligned}
      onFileDrop={readOnly ? undefined : onFileDrop}
      fileDropLabel={tio("dropOnMap")}
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
            onOpen={
              node.measuring || readOnly
                ? noop
                : () => {
                    if (!justDragged.current) onOpen(task);
                  }
            }
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
