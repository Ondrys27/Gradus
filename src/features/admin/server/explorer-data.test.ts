import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { isValidExplorerQuery, numericPropsOf } = await import("./explorer-data");

describe("explorer numeric properties", () => {
  it("never offers an amount that sits next to a currency", () => {
    for (const event of ["deal_created", "deal_won", "deal_lost"] as const) {
      expect(numericPropsOf(event)).not.toContain("value");
    }
    expect(
      isValidExplorerQuery({ event: "deal_won", calc: "sum", prop: "value", grain: "month" }),
    ).toBe(false);
  });

  it("still offers plain numbers", () => {
    expect(numericPropsOf("deal_won")).toContain("days_open");
    expect(numericPropsOf("contacts_generated")).toContain("saved");
  });
});
