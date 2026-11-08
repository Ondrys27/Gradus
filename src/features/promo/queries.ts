"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { planKeys } from "@/features/plan/queries";
import { subscriptionKeys } from "@/features/subscription/queries";
import { loadPromoStatus } from "./actions";

export const promoKeys = {
  status: (userId: string) => ["account", userId, "promo"] as const,
};

/** The owner's promo code and whether one can still be entered; null for a worker. */
export function usePromoStatus(enabled = true) {
  const { user, worker } = useSession();
  return useQuery({
    queryKey: promoKeys.status(user.id),
    queryFn: () => loadPromoStatus(),
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
