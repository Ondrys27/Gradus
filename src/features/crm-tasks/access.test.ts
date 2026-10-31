import { describe, expect, it } from "vitest";
import { workspaceFor } from "@/features/account/workspace";
import { canCreateTask, canEditTask, canTickTask } from "./access";

const OWNER = "0f4f8b6e-0000-4000-8000-0000000000a1";
const WORKER = "0f4f8b6e-0000-4000-8000-0000000000b2";
const worker = (permissions: Record<string, { view: boolean; edit: boolean }>, readOnly = false) =>
  workspaceFor(WORKER, { id: "w1", ownerId: OWNER }, permissions, readOnly);

const dealTask = { deal_id: "d1", contact_id: null, assignee_id: OWNER };
const contactTask = { deal_id: null, contact_id: "c1", assignee_id: WORKER };

describe("what the account may do with a task (mirrors the row security)", () => {
  it("lets the owner do everything, except in a read-only space", () => {
    const owner = workspaceFor(OWNER, null);
    expect(canEditTask(owner, dealTask)).toBe(true);
    expect(canCreateTask(owner, "any")).toBe(true);
    const readOnly = workspaceFor(OWNER, null, {}, true);
    expect(canEditTask(readOnly, dealTask)).toBe(false);
    expect(canTickTask(readOnly, dealTask)).toBe(false);
    expect(canCreateTask(readOnly, "any")).toBe(false);
  });

  it("lets a worker change tasks of the sections they may edit", () => {
    const pipeline = worker({ pipeline: { view: true, edit: true } });
    expect(canEditTask(pipeline, dealTask)).toBe(true);
    expect(canEditTask(pipeline, { ...contactTask, assignee_id: OWNER })).toBe(false);
    expect(canCreateTask(pipeline, { deal: true, contact: false })).toBe(true);
    expect(canCreateTask(pipeline, { deal: false, contact: true })).toBe(false);
    const coldCalling = worker({ cold_calling: { view: true, edit: true } });
    expect(canEditTask(coldCalling, contactTask)).toBe(true);
  });

  it("lets the person given a task only tick it off", () => {
    const nothing = worker({});
    expect(canEditTask(nothing, contactTask)).toBe(false);
    expect(canTickTask(nothing, contactTask)).toBe(true);
    expect(canTickTask(nothing, dealTask)).toBe(false);
    expect(canCreateTask(nothing, "any")).toBe(false);
    expect(canCreateTask(worker({ pipeline: { view: true, edit: false } }), "any")).toBe(false);
  });
});
