import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clientInsert, GUARD_SET_COLUMNS, type GuardedTable } from "./client-insert";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20261116090000_scheduler.sql"),
  "utf8",
);

/** The columns of `grant insert (…) on public.<table> to authenticated`. */
function insertGrant(table: string): string[] {
  const match = new RegExp(
    `grant insert \\(([^)]*)\\)\\s+on public\\.${table} to authenticated`,
    "i",
  ).exec(MIGRATION);
  if (!match) throw new Error(`no column insert grant for ${table}`);
  return match[1]!.split(",").map((column) => column.trim());
}

describe("clientInsert", () => {
  it("never sends a column the guards set (the client has no grant on it)", () => {
    for (const table of Object.keys(GUARD_SET_COLUMNS) as GuardedTable[]) {
      const granted = insertGrant(table);
      for (const column of GUARD_SET_COLUMNS[table]) expect(granted).not.toContain(column);
    }
  });

  it("drops the person and space even when a spread brings them", () => {
    const smuggled = { user_id: "someone", space_id: "elsewhere" } as object;
    const row = clientInsert("event_types", {
      ...smuggled,
      profile_id: "p",
      slug: "intro",
      name: "Intro",
    });
    expect(row).toEqual({ profile_id: "p", slug: "intro", name: "Intro" });
    expect(Object.keys(row).every((key) => insertGrant("event_types").includes(key))).toBe(true);
  });

  it("keeps the space of a new profile (granted, checked by RLS)", () => {
    const row = clientInsert("scheduler_profiles", {
      ...({ user_id: "someone" } as object),
      space_id: "s",
      handle: "jan-novak",
      time_zone: "Europe/Prague",
    });
    expect(row).toEqual({ space_id: "s", handle: "jan-novak", time_zone: "Europe/Prague" });
    expect(Object.keys(row).every((key) => insertGrant("scheduler_profiles").includes(key))).toBe(
      true,
    );
  });

  it("availability rows carry only the profile and the times", () => {
    const rule = clientInsert("availability_rules", {
      profile_id: "p",
      event_type_id: null,
      weekday: 1,
      start_time: "09:00",
      end_time: "17:00",
    });
    expect(Object.keys(rule).every((key) => insertGrant("availability_rules").includes(key))).toBe(
      true,
    );
    const override = clientInsert("availability_overrides", {
      profile_id: "p",
      date: "2026-12-24",
      start_time: null,
      end_time: null,
    });
    expect(
      Object.keys(override).every((key) => insertGrant("availability_overrides").includes(key)),
    ).toBe(true);
  });
});
