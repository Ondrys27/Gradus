import { describe, expect, it } from "vitest";
import {
  amountFromInput,
  emptyPermissions,
  inviteState,
  inviteUrl,
  monthStartOf,
  paymentSchema,
  permissionRows,
  permissionsFromRows,
  taskProgress,
  validate,
  workerSchema,
  workerTaskSchema,
} from "./logic";

describe("months and invites", () => {
  it("starts the month on its first day", () => {
    expect(monthStartOf("2026-09-28")).toBe("2026-09-01");
    expect(monthStartOf("2026-12-01")).toBe("2026-12-01");
  });

  it("builds the registration link from the site and the code", () => {
    expect(inviteUrl("0f3a9c1b2d4e5f60718a", "https://gradus.app/")).toBe(
      "https://gradus.app/register?invite=0f3a9c1b2d4e5f60718a",
    );
  });

  it("tells open, expired and accepted invites apart", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(inviteState({ expires_at: "2026-10-01T00:00:00Z", accepted_at: null }, now)).toBe("open");
    expect(inviteState({ expires_at: "2026-09-28T12:00:00Z", accepted_at: null }, now)).toBe(
      "expired",
    );
    expect(
      inviteState({ expires_at: "2026-09-01T00:00:00Z", accepted_at: "2026-08-30T10:00:00Z" }, now),
    ).toBe("accepted");
  });
});

describe("permissions", () => {
  it("stores a row per section, so a closed section is stored as closed", () => {
    const draft = { ...emptyPermissions(), pipeline: "edit" as const, contacts: "view" as const };
    const rows = permissionRows(draft);
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.section === "pipeline")).toEqual({
      section: "pipeline",
      can_view: true,
      can_edit: true,
    });
    expect(rows.find((row) => row.section === "finance")).toEqual({
      section: "finance",
      can_view: false,
      can_edit: false,
    });
    expect(permissionsFromRows(rows)).toEqual(draft);
  });

  it("ignores sections that cannot be given to a worker", () => {
    expect(
      permissionsFromRows([{ section: "workers", can_view: true, can_edit: true }]),
    ).toEqual(emptyPermissions());
  });
});

describe("forms", () => {
  it("needs a name and a valid e-mail; the role is optional", () => {
    expect(validate(workerSchema, { name: " ", email: "x", job_title: "" })).toEqual({
      ok: false,
      errors: { name: "nameRequired", email: "emailInvalid" },
    });
    expect(
      validate(workerSchema, { name: "Jana", email: " Jana@Example.com ", job_title: " " }),
    ).toEqual({ ok: true, data: { name: "Jana", email: "jana@example.com", job_title: null } });
  });

  it("keeps a task's empty details as null", () => {
    expect(
      validate(workerTaskSchema, { title: "Call 20 leads", description: "  ", due_date: null }),
    ).toEqual({ ok: true, data: { title: "Call 20 leads", description: null, due_date: null } });
  });

  it("accepts only positive payment amounts typed the local way", () => {
    expect(amountFromInput("12 500,50")).toBe(12500.5);
    expect(Number.isNaN(amountFromInput("abc"))).toBe(true);
    expect(
      validate(paymentSchema, { amount: amountFromInput(""), paid_on: "2026-09-28", note: "" }).ok,
    ).toBe(false);
    expect(
      validate(paymentSchema, { amount: 0, paid_on: "2026-09-28", note: "" }),
    ).toEqual({ ok: false, errors: { amount: "amountInvalid" } });
  });
});

describe("display", () => {
  it("never shows more than all tasks done", () => {
    expect(taskProgress(3, 4)).toBe(0.75);
    expect(taskProgress(0, 0)).toBe(0);
    expect(taskProgress(5, 4)).toBe(1);
  });
});
