"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogPlan } from "@/config/pricing";
import { localizePlans, type LocalizedPlans } from "@/features/plan/localized";
import type { RateTable } from "@/lib/exchange-rates";

/**
 * The exchange rates in the browser (GET /api/exchange-rates, public
 * reference data cached for an hour). A page the server rendered passes the
 * rates it had as `initial`, so nothing jumps while they load.
 */
export function useExchangeRates(initial?: RateTable): RateTable {
  const query = useQuery({
    queryKey: ["exchange-rates"],
    queryFn: async (): Promise<RateTable> => {
      const response = await fetch("/api/exchange-rates");
      if (!response.ok) throw new Error(`exchange rates: ${response.status}`);
      const body = (await response.json()) as { rates?: RateTable };
      return body.rates ?? {};
    },
    initialData: initial,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  return query.data ?? initial ?? EMPTY;
}

const EMPTY: RateTable = {};

/** The catalog in `currency` (manual price, else derived; EUR without a fresh rate). */
export function useLocalizedPlans(
  plans: readonly CatalogPlan[],
  currency: string,
  initialRates?: RateTable,
): LocalizedPlans {
  const rates = useExchangeRates(initialRates);
  return useMemo(() => localizePlans(plans, currency, rates), [plans, currency, rates]);
}
