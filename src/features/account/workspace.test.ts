import { describe, expect, it } from "vitest";
import {
  can,
  canAccess,
  canAccessContacts,
  canDo,
  cleanGrants,
  cleanPermissions,
  samePermissions,
  workspaceFor,
} from "./workspace";

const OWNER = "00000000-0000-4000-8000-000000000001";
const WORKER = "00000000-0000-4000-8000-000000000002";
const worker = { id: "w-1", ownerId: OWNER };

describe("workspaceFor", () => {
  it("puts an owner in their own space", () => {
    expect(workspaceFor(OWNER, null)).toEqual({
      id: OWNER,
      role: "owner",
      userId: OWNER,
      workerId: null,
      permissions: {},
      grants: {},
      readOnly: false,
    });
  });

  it("puts a worker in the space of the owner who invited them", () => {
    const workspace = workspaceFor(WORKER, worker, { contacts: ["view", "update"] });
    expect(workspace).toMatchObject({ id: OWNER, role: "worker", userId: WORKER, workerId: "w-1" });
    expect(workspace.permissions).toEqual({ contacts: { view: true, edit: true } });
  });
});

describe("canAccess", () => {
  it("lets the owner do everything, settings and workers included", () => {
    const owner = workspaceFor(OWNER, null);
    for (const section of ["finance", "contacts", "workers", "settings"] as const) {
      expect(canAccess(owner, section, "edit")).toBe(true);
    }
  });

  it("follows a worker's rights, edit including view", () => {
    const caller = workspaceFor(WORKER, worker, {
      contacts: ["view", "create"],
      cold_calling: ["view", "view_others_stats"],
    });
    expect(canAccess(caller, "contacts", "view")).toBe(true);
    expect(canAccess(caller, "contacts", "edit")).toBe(true);
    expect(canAccess(caller, "cold_calling", "view")).toBe(true);
    expect(canAccess(caller, "cold_calling", "edit")).toBe(false);
    expect(canAccess(caller, "finance", "view")).toBe(false);
    expect(canAccess(caller, "pipeline", "view")).toBe(false);
  });

  it("never opens workers or settings to a worker, whatever is stored", () => {
    const sneaky = workspaceFor(WORKER, worker, {
      workers: ["view"],
      settings: ["view"],
    } as never);
    expect(canAccess(sneaky, "workers", "view")).toBe(false);
    expect(canAccess(sneaky, "settings", "view")).toBe(false);
    expect(sneaky.permissions).toEqual({});
  });

  it("opens the shared contact tables with either contacts or cold calling", () => {
    const viaColdCalling = workspaceFor(WORKER, worker, { cold_calling: ["view", "call"] });
    expect(canAccessContacts(viaColdCalling, "edit")).toBe(true);
    expect(canAccessContacts(workspaceFor(WORKER, worker, {}), "view")).toBe(false);
  });
});

describe("after the trial", () => {
  it("lets nobody change the workspace, but everyone still sees it", () => {
    const owner = workspaceFor(OWNER, null, undefined, true);
    const caller = workspaceFor(WORKER, worker, { contacts: ["view", "update"] }, true);
    for (const section of ["milestones", "contacts", "finance", "workers"] as const) {
      expect(canAccess(owner, section, "edit")).toBe(false);
      expect(canAccess(owner, section, "view")).toBe(true);
    }
    expect(canAccess(caller, "contacts", "edit")).toBe(false);
    expect(canAccess(caller, "contacts", "view")).toBe(true);
    expect(canAccessContacts(caller, "edit")).toBe(false);
    // Personal settings are not the workspace's data.
    expect(canAccess(owner, "settings", "edit")).toBe(true);
  });
});

describe("permissions", () => {
  it("reads an edit-only row as view and edit", () => {
    expect(cleanPermissions({ calendar: { view: false, edit: true } })).toEqual({
      calendar: { view: true, edit: true },
    });
  });

  it("compares two sets by what they allow", () => {
    expect(samePermissions({ contacts: { view: true, edit: false } }, {})).toBe(false);
    expect(
      samePermissions(
        { contacts: { view: false, edit: false } },
        { finance: { view: false, edit: false } },
      ),
    ).toBe(true);
  });
});

describe("fine rights", () => {
  const seller = workspaceFor(WORKER, worker, {
    pipeline: ["view", "change_stage"],
    contacts: ["create"],
    finance: [],
    invoices: ["view"],
  });

  it("allows an action only with the section's view", () => {
    expect(canDo(seller, "pipeline", "change_stage")).toBe(true);
    expect(canDo(seller, "pipeline", "change_amount")).toBe(false);
    expect(canDo(seller, "contacts", "create")).toBe(false);
    expect(canDo(seller, "pipeline", "edit")).toBe(true);
  });

  it("opens Finance as a section with finance or invoices", () => {
    expect(can(seller, "finance", "view")).toBe(true);
    expect(canDo(seller, "finance", "view")).toBe(false);
    expect(can(seller, "invoices", "view")).toBe(true);
    expect(can(seller, "invoices", "issue")).toBe(false);
  });

  it("lets the owner do all of it but no write after the trial", () => {
    const owner = workspaceFor(OWNER, null, undefined, true);
    expect(canDo(owner, "contacts", "export")).toBe(true);
    expect(canDo(owner, "contacts", "delete")).toBe(false);
    expect(
      canDo(
        workspaceFor(WORKER, worker, { pipeline: ["view", "change_stage"] }, true),
        "pipeline",
        "change_stage",
      ),
    ).toBe(false);
  });

  it("drops unknown sections and actions", () => {
    expect(cleanGrants({ pipeline: ["view", "fly"], nope: ["view"] } as never)).toEqual({
      pipeline: ["view"],
    });
  });
});
