import { describe, expect, it } from "vitest";
import {
  grantAllows,
  grantRows,
  grantsFromRows,
  legacyAccess,
  templateGrants,
  templateOf,
  toggleGrant,
  type PermissionGrants,
} from "./permissions-catalog";

describe("grants", () => {
  it("reads missing rows as the defaults: own tasks and own branch", () => {
    expect(grantsFromRows([])).toEqual({ tasks: ["view"], company: ["view"] });
    expect(
      grantsFromRows([
        { section: "company", action: "view", allowed: false },
        { section: "pipeline", action: "view", allowed: true },
        { section: "pipeline", action: "fly", allowed: true },
      ]),
    ).toEqual({ pipeline: ["view"], tasks: ["view"] });
  });

  it("stores every right as a row, so a closed one is stored as closed", () => {
    const rows = grantRows({ pipeline: ["view", "change_stage"] });
    expect(rows).toContainEqual({ section: "pipeline", action: "change_stage", allowed: true });
    expect(rows).toContainEqual({ section: "finance", action: "view", allowed: false });
    expect(grantsFromRows(rows)).toEqual({ pipeline: ["view", "change_stage"] });
  });

  it("turns the section on with any right and clears it with its view", () => {
    let grants: PermissionGrants = {};
    grants = toggleGrant(grants, "pipeline", "change_amount", true);
    expect(grants.pipeline).toEqual(["view", "change_amount"]);
    grants = toggleGrant(grants, "pipeline", "change_amount", false);
    expect(grants.pipeline).toEqual(["view"]);
    grants = toggleGrant(
      toggleGrant(grants, "pipeline", "delete", true),
      "pipeline",
      "view",
      false,
    );
    expect(grants.pipeline).toBeUndefined();
  });

  it("allows an action only together with the view", () => {
    expect(grantAllows({ contacts: ["create"] }, "contacts", "create")).toBe(false);
    expect(grantAllows({ contacts: ["view", "create"] }, "contacts", "create")).toBe(true);
  });

  it("derives the older view / edit like the database", () => {
    expect(legacyAccess({ invoices: ["view"] }, "finance")).toEqual({ view: true, edit: false });
    expect(legacyAccess({ cold_calling: ["view", "view_others_stats"] }, "cold_calling")).toEqual({
      view: true,
      edit: false,
    });
    expect(legacyAccess({ pipeline: ["view", "change_stage"] }, "pipeline")).toEqual({
      view: true,
      edit: true,
    });
  });
});

describe("templates", () => {
  it("are recognised exactly, any change makes them custom", () => {
    for (const template of ["sales", "assistant", "accountant", "all"] as const) {
      expect(templateOf(templateGrants(template))).toBe(template);
    }
    const sales = templateGrants("sales");
    expect(templateOf(toggleGrant(sales, "finance", "view", true))).toBeNull();
  });

  it("keep finance closed for a salesperson and open for an accountant", () => {
    expect(templateGrants("sales").finance).toBeUndefined();
    expect(grantAllows(templateGrants("accountant"), "invoices", "issue")).toBe(true);
    expect(grantAllows(templateGrants("sales"), "pipeline", "view_all")).toBe(false);
  });
});
