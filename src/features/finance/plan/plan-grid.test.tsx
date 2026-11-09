// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { categoryNames } from "./category-names";
import { NOVEMBER_CELLS, NOVEMBER_OPENING, NOVEMBER_ROWS } from "./fixtures";
import { buildMonthModel } from "./month-model";
import { PlanGrid, type GuideState } from "./plan-grid";
import type { PlanView } from "./sheet";

afterEach(cleanup);

const plan = {
  month: { id: "m", month: "2026-11", opening_capital: NOVEMBER_OPENING, reserve: null, currency: "CZK", closed: false },
  rows: NOVEMBER_ROWS,
  cells: NOVEMBER_CELLS,
};

function setup(options: { view?: PlanView; canEdit?: boolean; locale?: "cs" | "en"; guide?: GuideState; opening?: number } = {}) {
  const handlers = {
    onSaveCell: vi.fn(),
    onSaveOpening: vi.fn(),
    onAddRow: vi.fn(async () => "new-row"),
    onRenameRow: vi.fn(async () => true),
    onDeleteRow: vi.fn(),
    onMoveRow: vi.fn(),
    onOpenCell: vi.fn(),
    onAcceptSuggestion: vi.fn(),
  };
  const view = options.view ?? "plan";
  const opening = options.opening ?? NOVEMBER_OPENING;
  const modelOf = (cells: typeof NOVEMBER_CELLS) => buildMonthModel({
    monthKey: "2026-11",
    plan: { ...plan, month: { ...plan.month, opening_capital: opening }, cells },
    transactions: [],
    deals: [],
    view,
    today: "2026-11-10",
    hideEmpty: false,
    categoryNames: categoryNames(),
  });
  const missing: string[] = [];
  const locale = options.locale ?? "cs";
  const node = (cells = NOVEMBER_CELLS): ReactNode => (
    <NextIntlClientProvider locale={locale} messages={locale === "cs" ? cs : en} onError={(error) => missing.push(error.message)}>
      <PlanGrid
        model={modelOf(cells)}
        view={view}
        opening={opening}
        currency="CZK"
        canEdit={options.canEdit ?? true}
        guide={options.guide ?? null}
        {...handlers}
      />
    </NextIntlClientProvider>
  );
  const { rerender } = render(node());
  expect(missing).toEqual([]);
  return { ...handlers, rerender: (cells: typeof NOVEMBER_CELLS) => rerender(node(cells)) };
}

const cell = (row: string, week: string) => screen.getByRole("gridcell", { name: `${row}, ${week}` });

describe("PlanGrid", () => {
  it("shows the computed capital of the owner's November", () => {
    setup();
    expect(cell("Konečný kapitál", "Týden 1").textContent).toMatch(/6\s500/);
    expect(cell("Konečný kapitál", "Celkem").textContent).toMatch(/17\s000/);
    expect(cell("Počáteční kapitál", "Týden 2").textContent).toMatch(/6\s500/);
    expect(cell("Příjmy celkem", "Celkem").textContent).toMatch(/74\s500/);
    expect(cell("Bilance týdne", "Týden 1").querySelector(".text-pink")).not.toBeNull();
  });

  it("edits in place: typing starts, Enter saves and moves down", () => {
    const handlers = setup();
    const target = cell("Grid", "Týden 1");
    fireEvent.click(target);
    const input = screen.getByRole("textbox", { name: "Grid, Týden 1" });
    fireEvent.change(input, { target: { value: "12,5k" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onSaveCell).toHaveBeenCalledWith({
      rowId: "grid",
      kind: "income",
      week: 1,
      value: 12500,
      expression: false,
    });
    expect(handlers.onSaveCell).toHaveBeenCalledTimes(1);
  });

  it("an expression is computed, Tab moves right, Esc cancels", () => {
    const handlers = setup();
    fireEvent.click(cell("Nájem", "Týden 2"));
    const input = screen.getByRole("textbox", { name: "Nájem, Týden 2" });
    fireEvent.change(input, { target: { value: "3*4000" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(handlers.onSaveCell).toHaveBeenLastCalledWith(
      expect.objectContaining({ rowId: "rent", week: 2, value: 12000, expression: true }),
    );
    fireEvent.click(cell("Mzdy", "Týden 1"));
    const other = screen.getByRole("textbox", { name: "Mzdy, Týden 1" });
    fireEvent.change(other, { target: { value: "999" } });
    fireEvent.keyDown(other, { key: "Escape" });
    expect(handlers.onSaveCell).toHaveBeenCalledTimes(1);
  });

  it("refuses nonsense and keeps editing", () => {
    const handlers = setup();
    fireEvent.click(cell("Grid", "Týden 3"));
    const input = screen.getByRole("textbox", { name: "Grid, Týden 3" });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onSaveCell).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("the opening capital of week 1 is typed in, the later weeks are computed", () => {
    const handlers = setup();
    fireEvent.click(cell("Počáteční kapitál", "Týden 1"));
    const input = screen.getByRole("textbox", { name: "Počáteční kapitál, Týden 1" });
    fireEvent.change(input, { target: { value: "9 000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onSaveOpening).toHaveBeenCalledWith(9000);
    fireEvent.click(cell("Počáteční kapitál", "Týden 2"));
    expect(screen.queryByRole("textbox", { name: "Počáteční kapitál, Týden 2" })).toBeNull();
  });

  it("in Actual the cells open the week's transactions instead of editing", () => {
    const handlers = setup({ view: "actual" });
    fireEvent.click(cell("Grid", "Týden 2"));
    expect(screen.queryByRole("textbox", { name: "Grid, Týden 2" })).toBeNull();
    expect(handlers.onOpenCell).toHaveBeenCalledWith("grid", "income", "Grid", 2);
  });

  it("a new name above the total makes a row", async () => {
    const handlers = setup();
    const input = screen.getByRole("textbox", { name: "Nový výdaj" });
    fireEvent.change(input, { target: { value: "Benzín" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onAddRow).toHaveBeenCalledWith("expense", "Benzín");
  });

  it("without the right to edit nothing is editable and no new row is offered", () => {
    const handlers = setup({ canEdit: false, locale: "en" });
    fireEvent.click(cell("Grid", "Week 1"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(handlers.onSaveCell).not.toHaveBeenCalled();
  });

  it("names the currency once, in the corner of the header", () => {
    setup();
    expect(screen.getByRole("columnheader", { name: /Částky v CZK/ })).toBeTruthy();
    expect(screen.queryAllByText(/Kč/)).toHaveLength(0);
  });

  it("a fresh month shows the three first steps and leads into them", () => {
    setup({ guide: { opening: true, income: false, expense: false } });
    const guide = screen.getByRole("list", { name: "Jak začít" });
    expect(guide.textContent).toContain("Zadej počáteční kapitál");
    const next = screen.getByRole("button", { name: "Přidej první příjem" });
    expect(next.getAttribute("aria-current")).toBe("step");
    fireEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Nový příjem" }));
    fireEvent.click(screen.getByRole("button", { name: /Zadej počáteční kapitál/ }));
    expect(screen.getByRole("textbox", { name: "Počáteční kapitál, Týden 1" })).toBeTruthy();
  });

  it("the guide is gone once all three steps are done, and never without the right to edit", () => {
    setup({ guide: { opening: true, income: true, expense: true } });
    expect(screen.queryByRole("list", { name: "Jak začít" })).toBeNull();
    cleanup();
    setup({ guide: { opening: false, income: false, expense: false }, canEdit: false });
    expect(screen.queryByRole("list", { name: "Jak začít" })).toBeNull();
  });

  it("the lowest closing capital below zero stands out in the table", () => {
    setup({ opening: -20000 });
    const lowest = cell("Konečný kapitál", "Týden 1");
    expect(lowest.getAttribute("title")).toBe("Nejnižší stav měsíce");
    expect(lowest.className).toContain("bg-pink");
  });

  it("after a typed number the recomputed cells flash, the untouched ones do not", () => {
    const handlers = setup();
    fireEvent.click(cell("Grid", "Týden 1"));
    const input = screen.getByRole("textbox", { name: "Grid, Týden 1" });
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onSaveCell).toHaveBeenCalledWith(expect.objectContaining({ rowId: "grid", week: 1, value: 5000 }));
    handlers.rerender([...NOVEMBER_CELLS, { row_id: "grid", week: 1, planned: 5000, note: null }]);
    const flash = (row: string, week: string) => cell(row, week).querySelector('[class*="animate-plan-flash"]');
    expect(flash("Příjmy celkem", "Týden 1")).not.toBeNull();
    expect(flash("Konečný kapitál", "Celkem")).not.toBeNull();
    expect(flash("Výdaje celkem", "Týden 1")).toBeNull();
  });
});
