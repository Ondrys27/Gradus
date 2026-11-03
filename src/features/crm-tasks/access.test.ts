import { describe, expect, it } from "vitest";
import { workspaceFor } from "@/features/account/workspace";
import type { PermissionGrants } from "@/features/workers/permissions-catalog";
import { canAssignOthers, canCreateTask, canDeleteTask, canEditTask, canTickTask } from "./access";

const OWNER = "0f4f8b6e-0000-4000-8000-0000000000a1";
const WORKER = "0f4f8b6e-0000-4000-8000-0000000000b2";
const worker = (grants: PermissionGrants, readOnly = false) =>
  workspaceFor(WORKER, { id: "w1", ownerId: OWNER }, grants, readOnly);

const dealTask = { deal_id: "d1", contact_id: null, assignee_id: OWNER, deal: { id: "d1" } };
const hiddenDealTask = { deal_id: "d2", contact_id: null, assignee_id: WORKER, deal: null };
const contactTask = { deal_id: null, contact_id: "c1", assignee_id: WORKER };

const editor: PermissionGrants = {
  pipeline: ["view", "view_all"],
  tasks: ["view", "view_all", "create", "update", "delete"],
};

describe("what the account may do with a task (mirrors the row security)", () => {
  it("lets the owner do everything, except in a read-only space", () => {
    const owner = workspaceFor(OWNER, null);
    expect(canEditTask(owner, dealTask)).toBe(true);
    expect(canCreateTask(owner, "any")).toBe(true);
    expect(canAssignOthers(owner)).toBe(true);
    const readOnly = workspaceFor(OWNER, null, {}, true);
    expect(canEditTask(readOnly, dealTask)).toBe(false);
    expect(canTickTask(readOnly, dealTask)).toBe(false);
    expect(canDeleteTask(readOnly, dealTask)).toBe(false);
    expect(canCreateTask(readOnly, "any")).toBe(false);
  });

  it("lets a worker change, create and delete tasks by the rights of Tasks", () => {
    const tasks = worker(editor);
    expect(canEditTask(tasks, dealTask)).toBe(true);
    expect(canDeleteTask(tasks, dealTask)).toBe(true);
    expect(canCreateTask(tasks, { deal: true, contact: false })).toBe(true);
    // The contact is not theirs to see.
    expect(canEditTask(tasks, { ...contactTask, assignee_id: OWNER })).toBe(false);
    expect(canCreateTask(tasks, { deal: false, contact: true })).toBe(false);
    // Seeing the pipeline is not enough without the rights of Tasks.
    const viewer = worker({ pipeline: ["view", "view_all"] });
    expect(canEditTask(viewer, dealTask)).toBe(false);
    expect(canCreateTask(viewer, "any")).toBe(false);
  });

  it("keeps a worker without 'all tasks' to their own", () => {
    const own = worker({ pipeline: ["view"], tasks: ["view", "update", "delete"] });
    expect(canEditTask(own, dealTask)).toBe(false);
    expect(canDeleteTask(own, dealTask)).toBe(false);
    // Their own task on a deal they cannot see: only ticking it off.
    expect(canEditTask(own, hiddenDealTask)).toBe(false);
    expect(canTickTask(own, hiddenDealTask)).toBe(true);
    expect(canDeleteTask(own, hiddenDealTask)).toBe(true);
  });

  it("gives tasks to others only with 'assign to others'", () => {
    expect(canAssignOthers(worker(editor))).toBe(false);
    expect(canAssignOthers(worker({ tasks: ["view", "assign_others"] }))).toBe(true);
    expect(canAssignOthers(worker({ tasks: ["view", "assign_others"] }, true))).toBe(false);
  });

  it("lets the person given a task only tick it off", () => {
    const nothing = worker({});
    expect(canEditTask(nothing, contactTask)).toBe(false);
    expect(canTickTask(nothing, contactTask)).toBe(true);
    expect(canTickTask(nothing, dealTask)).toBe(false);
    expect(canCreateTask(nothing, "any")).toBe(false);
  });
});
