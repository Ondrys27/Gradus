import { describe, expect, it } from "vitest";
import {
  applyMove,
  contactLabel,
  countRelaunchable,
  groupDealsByStage,
  isRelaunchable,
  moveKind,
  nextDealPosition,
  reorderStages,
  sumByCurrency,
} from "./board-logic";
import type { Deal, Stage } from "./types";

const stage = (id: string, position: number, extra: Partial<Stage> = {}): Stage => ({
  id,
  name: id,
  color: "violet",
  position,
  is_won: false,
  is_lost: false,
  system_key: null,
  deposit_percent: 30,
  ...extra,
});

const deal = (id: string, stage_id: string, extra: Partial<Deal> = {}): Deal => ({
  id,
  contact_id: null,
  stage_id,
  title: id,
  description: null,
  value: null,
  currency: "CZK",
  expected_close_date: null,
  position: 0,
  entered_stage_at: "2026-09-01T10:00:00Z",
  won_at: null,
  lost_at: null,
  lost_reason: null,
  created_at: "2026-09-01T10:00:00Z",
  contact: null,
  ...extra,
});

const lead = stage("lead", 0);
const won = stage("won", 1, { is_won: true });
const lost = stage("lost", 2, { is_lost: true });
const now = new Date("2026-09-24T12:00:00Z");

describe("groupDealsByStage", () => {
  it("groups by stage, orders by position and skips unknown stages", () => {
    const groups = groupDealsByStage(
      [lead, won],
      [deal("b", "lead", { position: 1 }), deal("a", "lead", { position: 0 }), deal("x", "gone")],
    );
    expect(groups.get("lead")?.map((d) => d.id)).toEqual(["a", "b"]);
    expect(groups.get("won")).toEqual([]);
    expect(groups.has("gone")).toBe(false);
  });
});

describe("sumByCurrency", () => {
  it("adds per currency and ignores deals without an amount", () => {
    const totals = sumByCurrency([
      deal("a", "lead", { value: 1000 }),
      deal("b", "lead", { value: 500.5 }),
      deal("c", "lead", { value: 20, currency: "EUR" }),
      deal("d", "lead"),
    ]);
    expect(totals).toEqual([
      { currency: "CZK", total: 1500.5 },
      { currency: "EUR", total: 20 },
    ]);
  });
});

describe("re-engage rule", () => {
  it("flags a deal lost for more than the default six months, not before", () => {
    const old = deal("a", "lost", { entered_stage_at: "2026-03-01T00:00:00Z" });
    const recent = deal("b", "lost", { entered_stage_at: "2026-04-01T00:00:00Z" });
    expect(isRelaunchable(old, lost, now)).toBe(true);
    expect(isRelaunchable(recent, lost, now)).toBe(false);
  });

  it("never flags a deal outside a lost stage", () => {
    const old = deal("a", "lead", { entered_stage_at: "2025-01-01T00:00:00Z" });
    expect(isRelaunchable(old, lead, now)).toBe(false);
    expect(isRelaunchable(old, won, now)).toBe(false);
  });

  it("counts flagged deals within one stage", () => {
    const deals = [
      deal("a", "lost", { entered_stage_at: "2026-01-01T00:00:00Z" }),
      deal("b", "lost", { entered_stage_at: "2026-09-01T00:00:00Z" }),
    ];
    expect(countRelaunchable(deals, lost, now)).toBe(1);
  });

  it("takes the re-engage window from the setting, not a fixed six months", () => {
    const recent = deal("a", "lost", { entered_stage_at: "2026-08-01T00:00:00Z" });
    expect(isRelaunchable(recent, lost, now, 6)).toBe(false);
    expect(isRelaunchable(recent, lost, now, 1)).toBe(true);
  });
});

describe("moves", () => {
  it("classifies a move by its target", () => {
    const d = deal("a", "lead");
    expect(moveKind(d, lead)).toBe("none");
    expect(moveKind(d, won)).toBe("won");
    expect(moveKind(d, lost)).toBe("lost");
    expect(moveKind(d, stage("offer", 3))).toBe("open");
    expect(moveKind(d, undefined)).toBe("none");
  });

  it("puts a moved deal last in its new stage and restamps it", () => {
    const deals = [deal("a", "lead"), deal("b", "won", { position: 4 })];
    expect(nextDealPosition(deals, "won")).toBe(5);
    expect(nextDealPosition(deals, "lost")).toBe(0);
    const moved = applyMove(deals, "a", won, now).find((d) => d.id === "a")!;
    expect(moved).toMatchObject({ stage_id: "won", position: 5, lost_at: null });
    expect(moved.won_at).toBe(now.toISOString());
    expect(moved.entered_stage_at).toBe(now.toISOString());
  });

  it("clears won and lost marks when returning to an open stage", () => {
    const d = deal("a", "lost", { lost_at: "2026-01-01T00:00:00Z", lost_reason: "Price" });
    const back = applyMove([d], "a", lead, now)[0];
    expect(back.lost_at).toBeNull();
    expect(back.lost_reason).toBeNull();
    expect(back.won_at).toBeNull();
  });
});

describe("reorderStages", () => {
  it("returns only the positions that changed", () => {
    const { stages, changes } = reorderStages([lead, won, lost], "lost", "lead");
    expect(stages.map((s) => s.id)).toEqual(["lost", "lead", "won"]);
    expect(changes).toHaveLength(3);
    expect(reorderStages([lead, won, lost], "lead", "won").changes).toEqual([
      { id: "won", position: 0 },
      { id: "lead", position: 1 },
    ]);
    expect(reorderStages([lead, won], "lead", "lead").changes).toEqual([]);
  });
});

describe("contactLabel", () => {
  it("prefers the company, then the person's name", () => {
    const base = { id: "c", company_name: null, first_name: null, last_name: null };
    expect(contactLabel(null)).toBe("");
    expect(contactLabel({ ...base, company_name: "Acme" })).toBe("Acme");
    expect(contactLabel({ ...base, first_name: "Jana", last_name: "Nová" })).toBe("Jana Nová");
  });
});
