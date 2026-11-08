"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { planKeys } from "@/features/plan/queries";
import { subscriptionKeys } from "@/features/subscription/queries";
import type { PromoStatus } from "./server/promo";

export const promoKeys = {
  status: (userId: string) => ["account", userId, "promo"] as const,
};

export const PROMO_STATUS_PATH = "/api/promo/status";

/**
 * A plain request rather than a server action: server actions run one at a
 * time behind the router, and right after the registration's redirect this
 * read would wait there instead of reaching the server.
 */
async function fetchPromoStatus(): Promise<PromoStatus | null> {
  const response = await fetch(PROMO_STATUS_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`promo status ${response.status}`);
  const body = (await response.json()) as { status?: PromoStatus | null };
  return body.status ?? null;
}

/** The owner's promo code and whether one can still be entered; null for a worker. */
export function usePromoStatus(enabled = true) {
  const { user, worker } = useSession();
  return useQuery({
    queryKey: promoKeys.status(user.id),
    queryFn: fetchPromoStatus,
    enabled: enabled && !worker,
    staleTime: 60_000,
  });
}

/** After a code was used: the code, the subscription (a longer trial) and the plan the app reads. */
export function useRefreshAfterPromo() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: promoKeys.status(user.id) }),
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.subscription(user.id) }),
      queryClient.invalidateQueries({ queryKey: planKeys.plan(user.id, user.id) }),
    ]);
}
