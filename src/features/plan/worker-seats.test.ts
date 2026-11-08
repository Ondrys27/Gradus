import { describe, expect, it } from "vitest";
import {
  catalogWorkerTerms,
  extraWorkersCharge,
  storedWorkerTerms,
  workerSeats,
  type SeatWorker,
  type WorkerTerms,
} from "./worker-seats";

const PRICE = { CZK: 290, EUR: 12 };
const free: WorkerTerms = { included: 0, perWorker: null };
const pro: WorkerTerms = { included: 0, perWorker: PRICE };
const team: WorkerTerms = { included: 10, perWorker: PRICE };

const people = (...own: boolean[]): SeatWorker[] => own.map((ownPlan, index) => ({ id: `w${index}`, ownPlan }));

describe("workerSeats", () => {
  it("a worker with a plan of their own is free whatever the owner's plan", () => {
    for (const terms of [free, pro, team]) {
      const result = workerSeats(terms, people(true, true));
      expect(result).toMatchObject({ own: 2, included: 0, extra: 0 });
      expect(result.seats.get("w0")).toBe("own");
    }
  });

  it("Pro: nobody in the price, every worker without a plan is extra", () => {
    const result = workerSeats(pro, people(false, true, false));
    expect(result).toMatchObject({ own: 1, included: 0, extra: 2, freeIncluded: 0 });
    expect([...result.seats.values()]).toEqual(["extra", "own", "extra"]);
    expect(extraWorkersCharge(result, 290, "monthly")).toBe(580);
  });

  it("Team: ten in the price go to the earliest, then each one is extra", () => {
    const workers = people(...Array.from({ length: 12 }, () => false), true);
    const result = workerSeats(team, workers);
    expect(result).toMatchObject({ own: 1, included: 10, extra: 2 });
    expect(result.seats.get("w0")).toBe("included");
    expect(result.seats.get("w9")).toBe("included");
    expect(result.seats.get("w10")).toBe("extra");
    expect(result.seats.get("w12")).toBe("own");
    expect(extraWorkersCharge(result, 290, "monthly")).toBe(580);
    expect(workerSeats(team, people(false, false, false)).freeIncluded).toBe(7);
  });

  it("3 in the price and 2 extra: the line of the subscription", () => {
    const result = workerSeats({ included: 3, perWorker: PRICE }, people(false, false, false, false, false));
    expect(result).toMatchObject({ included: 3, extra: 2 });
  });

  it("a worker who pays for their own plan later stops being extra", () => {
    const before = workerSeats(pro, people(false, false));
    const after = workerSeats(pro, people(false, true));
    expect(extraWorkersCharge(before, 290, "monthly")).toBe(580);
    expect(extraWorkersCharge(after, 290, "monthly")).toBe(290);
  });

  it("counts a worker once", () => {
    const result = workerSeats(pro, [
      { id: "a", ownPlan: false },
      { id: "a", ownPlan: false },
    ]);
    expect(result.extra).toBe(1);
  });
});

describe("extraWorkersCharge", () => {
  it("nothing extra costs nothing, even on a plan without a price", () => {
    expect(extraWorkersCharge({ extra: 0 }, null, "monthly")).toBe(0);
  });

  it("extra workers on a plan that takes none have no price", () => {
    expect(extraWorkersCharge({ extra: 1 }, null, "monthly")).toBeNull();
  });

  it("a year is twelve months of the monthly price, to the cent", () => {
    expect(extraWorkersCharge({ extra: 2 }, 241.67, "yearly")).toBe(5800.08);
    expect(extraWorkersCharge({ extra: 3 }, 12.5, "monthly")).toBe(37.5);
  });
});

describe("terms", () => {
  it("from the catalog: included workers and the price per extra worker", () => {
    expect(catalogWorkerTerms({ included_workers: 10, per_worker: PRICE })).toEqual(team);
    expect(catalogWorkerTerms({ included_workers: 0, per_worker: null })).toEqual(free);
  });

  it("from the plans table: an unreadable price is none", () => {
    expect(storedWorkerTerms({ included_workers: 0, per_worker: PRICE })).toEqual(pro);
    expect(storedWorkerTerms({ included_workers: 2, per_worker: { CZK: "290" } })).toEqual({
      included: 2,
      perWorker: null,
    });
    expect(storedWorkerTerms(null)).toEqual(free);
  });
});
