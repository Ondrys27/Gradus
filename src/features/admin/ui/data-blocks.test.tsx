import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { heatmapGrid } from "../cohorts";
import { buildTable } from "../table";
import { BreakdownList, CohortTable, DataTable, FieldsGrid, Funnel, UsageHeatmap } from "./data-blocks";
import { TileGrid } from "./metric-tile";

afterEach(cleanup);

/** Fails the test on any missing translation, in both languages. */
function renderIn(locale: "cs" | "en", node: ReactNode) {
  const missing: string[] = [];
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "cs" ? cs : en}
      onError={(error) => missing.push(error.message)}
    >
      {node}
    </NextIntlClientProvider>,
  );
  expect(missing).toEqual([]);
}

const steps = [
  {
    key: "registered",
    users: 10,
    pctOfStart: 100,
    pctOfPrevious: 100,
    medianHoursFromPrevious: null,
    medianHoursFromStart: null,
  },
  {
    key: "onboarding_completed",
    users: 6,
    pctOfStart: 60,
    pctOfPrevious: 60,
    medianHoursFromPrevious: 1.5,
    medianHoursFromStart: 1.5,
    previousPctOfStart: 50,
  },
];

describe.each(["cs", "en"] as const)("admin blocks in %s", (locale) => {
  it("renders the funnel with drop-off and change", () => {
    renderIn(locale, <Funnel steps={steps} />);
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText(/40,0\s%|40\.0%/)).toBeTruthy();
  });

  it("renders tiles, including a pending one", () => {
    renderIn(
      locale,
      <TileGrid
        tiles={[
          { key: "signups", unit: "users", value: 12, previous: 6, spark: [1, 5, 6] },
          { key: "stickiness", unit: "ratio", value: 0.2, previous: null },
          { key: "nps", unit: "count", value: null, pending: "11.5" },
        ]}
      />,
    );
    expect(screen.getByText(/\+100,0\s%|\+100\.0%/)).toBeTruthy();
  });

  it("renders cohorts, the heat map, breakdowns and fields", () => {
    renderIn(
      locale,
      <>
        <CohortTable
          cohorts={[{ week: "2026-09-28", size: 4, cells: [100, 25, null] }]}
          weeks={2}
        />
        <UsageHeatmap grid={heatmapGrid([{ weekday: 1, hour: 9, events: 3, users: 2 }])} />
        <BreakdownList
          data={{
            key: "users_by_plan",
            unit: "users",
            items: [
              { key: "beta", value: 3, previous: 1 },
              { key: "none", value: 1 },
            ],
          }}
        />
        <FieldsGrid
          data={{
            key: "waitlist",
            fields: [{ name: "joined", unit: "count", value: 4, previous: 2 }],
          }}
        />
      </>,
    );
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("renders a table built on the server", () => {
    renderIn(
      locale,
      <DataTable
        id="test.table"
        table={buildTable(
          [{ job: "daily-stats", runs: 7 }],
          [
            { key: "job", label: "Job", render: (row) => row.job },
            { key: "runs", label: "Runs", align: "right", render: (row) => `${row.runs}×` },
          ],
        )}
      />,
    );
    expect(screen.getByText("daily-stats")).toBeTruthy();
    expect(screen.getByText("7×").className).toContain("text-right");
  });

  it("explains an empty block instead of showing zeros", () => {
    renderIn(locale, <Funnel steps={[]} />);
    expect(screen.getByText(locale === "cs" ? "Zatím žádná data" : "No data yet")).toBeTruthy();
  });
});
