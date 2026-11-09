import type { Billing, CatalogPlan, Money } from "@/config/pricing";

/**
 * Who pays for a company's workers (step 22.5). A worker with a valid plan of
 * their own joins for free; everybody else takes a seat of the owner's plan:
 * the first `included` seats are in the price, each one beyond is extra at
 * `perWorker` a month (yearly: the year's twelve months). The seats in the
 * price go to the earliest workers. Nothing is charged before a payment
 * gateway exists; this only computes what the owner is shown. The database
 * answers the same per worker in worker_seats() (own plan or not, oldest first).
 */

/** What the owner's plan says about workers. */
export type WorkerTerms = {
  /** Workers without a plan of their own the price covers. */
  included: number;
  /** The monthly price of each extra one; null = the plan takes no extra workers. */
  perWorker: Money | null;
};

/** One worker of the company, oldest first. */
export type SeatWorker = { id: string; ownPlan: boolean };

/** How one worker is paid for: their own plan, in the owner's price, or extra. */
export type Seat = "own" | "included" | "extra";

export type WorkerSeats = {
  seats: ReadonlyMap<string, Seat>;
  own: number;
  included: number;
  extra: number;
  /** Seats in the price that nobody takes yet. */
  freeIncluded: number;
};

export function workerSeats(terms: WorkerTerms, workers: readonly SeatWorker[]): WorkerSeats {
  const included = Math.max(0, Math.floor(terms.included));
  const seats = new Map<string, Seat>();
  let own = 0;
  let inPrice = 0;
  let extra = 0;
  for (const worker of workers) {
    if (seats.has(worker.id)) continue;
    if (worker.ownPlan) {
      seats.set(worker.id, "own");
      own += 1;
    } else if (inPrice < included) {
      seats.set(worker.id, "included");
      inPrice += 1;
    } else {
      seats.set(worker.id, "extra");
      extra += 1;
    }
  }
  return { seats, own, included: inPrice, extra, freeIncluded: included - inPrice };
}

/**
 * What the extra workers add to one payment of the owner's plan: extra ×
 * the monthly price of one (for a yearly plan its discounted monthly price,
 * perWorkerPrice), twelve times that for a year. Null when there are extra
 * workers but the plan has no price for them (they do not fit the plan); 0
 * without extra workers.
 */
export function extraWorkersCharge(
  seats: Pick<WorkerSeats, "extra">,
  monthlyPrice: number | null,
  billing: Billing,
): number | null {
  if (seats.extra === 0) return 0;
  if (monthlyPrice === null) return null;
  const monthly = Math.round(seats.extra * monthlyPrice * 100) / 100;
  return billing === "yearly" ? Math.round(monthly * 12 * 100) / 100 : monthly;
}

/** The terms of a plan of the published catalog. */
export function catalogWorkerTerms(plan: Pick<CatalogPlan, "included_workers" | "per_worker">): WorkerTerms {
  return { included: plan.included_workers ?? 0, perWorker: plan.per_worker ? { ...plan.per_worker } : null };
}

/** The terms of a plan outside the catalog (beta), from the plans table; anything unreadable is none. */
export function storedWorkerTerms(row: { included_workers: number | null; per_worker: unknown } | null): WorkerTerms {
  const price = row?.per_worker as Record<string, unknown> | null | undefined;
  // EUR always, other currencies as set; every amount above zero.
  const valid =
    price &&
    typeof price === "object" &&
    typeof price.EUR === "number" &&
    Object.values(price).every((amount) => typeof amount === "number" && amount > 0);
  return {
    included: Math.max(0, Math.floor(row?.included_workers ?? 0)),
    perWorker: valid ? ({ ...price } as Money) : null,
  };
}
