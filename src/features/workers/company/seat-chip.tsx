"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { useSession, useUserSettings } from "@/features/account/queries";
import { salesLive } from "@/features/billing/sales";
import { useExchangeRates } from "@/features/currency/use-exchange-rates";
import { moneyIn } from "@/features/plan/localized";
import { workerSeats, type Seat } from "@/features/plan/worker-seats";
import { money } from "@/features/subscription/plan-price";
import { useWorkerBilling } from "@/features/subscription/queries";
import { BASE_CURRENCY } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { WorkerStatus } from "../types";

type SeatInfo = { seat: Seat | null; declined: boolean; replaced: boolean; pendingAccount: boolean };

/** Most records an owner's replaced invites are read for. */
const REPLACED_LIMIT = 500;

/** The owner's workers whose invite a newer one to the same e-mail replaced (27.1). */
function useReplacedWorkers(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: ["workers", user.id, "replaced-invites"],
    enabled,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await createClient()
        .from("worker_invites")
        .select("worker_id")
        .eq("owner_id", user.id)
        .not("replaced_at", "is", null)
        .order("replaced_at", { ascending: false })
        .limit(REPLACED_LIMIT);
      if (error) throw error;
      return new Set(data.map((row) => row.worker_id));
    },
  });
}

/**
 * Who pays for each of the owner's workers (step 22.5), from the same rows as
 * Settings → Subscription: one query for the whole company. Only the owner
 * in their own space has it; anybody else gets an empty map.
 */
export function useCompanySeats(): { seats: ReadonlyMap<string, SeatInfo>; price: string | null } {
  const { user, spaceId, worker } = useSession();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const isOwner = !worker && spaceId === user.id;
  const query = useWorkerBilling(isOwner);
  const replacedQuery = useReplacedWorkers(isOwner);
  const rates = useExchangeRates();
  return useMemo(() => {
    const out = new Map<string, SeatInfo>();
    if (!query.data) return { seats: out, price: null };
    const { terms, workers } = query.data;
    const counted = workers.filter((row) => row.status !== "inactive");
    const result = workerSeats(
      terms,
      counted.map((row) => ({ id: row.workerId, ownPlan: row.ownPlan })),
    );
    for (const row of workers) {
      out.set(row.workerId, {
        seat: result.seats.get(row.workerId) ?? null,
        declined: row.declined,
        replaced: row.status === "inactive" && Boolean(replacedQuery.data?.has(row.workerId)),
        pendingAccount: row.pendingAccount,
      });
    }
    // The user's currency (manual or at the day's rate), else EUR.
    const local = terms.perWorker ? moneyIn(terms.perWorker, settings.currency, rates) : null;
    const price = terms.perWorker
      ? local
        ? money(local.amount, settings.currency, format)
        : money(terms.perWorker.EUR, BASE_CURRENCY, format)
      : null;
    return { seats: out, price };
  }, [query.data, replacedQuery.data, settings.currency, format, rates]);
}

/** "has their own plan" / "in the price" / "extra 290 Kč", and a declined or waiting invite. */
export function SeatChip({
  workerId,
  status,
  seats,
}: {
  workerId: string;
  status: WorkerStatus;
  seats: ReturnType<typeof useCompanySeats>;
}) {
  const t = useTranslations("workers.company.seat");
  const info = seats.seats.get(workerId);
  if (!info) return null;
  if (info.declined) {
    return (
      <StatusPill tone="pink" data-testid="seat-chip">
        {t("declined")}
      </StatusPill>
    );
  }
  if (info.replaced) {
    return (
      <StatusPill tone="neutral" data-testid="seat-chip" data-seat="replaced">
        {t("replaced")}
      </StatusPill>
    );
  }
  if (status === "inactive" || !info.seat) return null;
  return (
    <>
      {info.pendingAccount && (
        <StatusPill tone="violet" data-testid="invite-waiting">
          {t("waiting")}
        </StatusPill>
      )}
      <StatusPill
        tone={info.seat === "own" ? "green" : info.seat === "included" ? "teal" : "gold"}
        data-testid="seat-chip"
        data-seat={info.seat}
        title={info.seat === "extra" && seats.price && !salesLive() ? t("extraBeforeSalesHint") : undefined}
      >
        {info.seat === "own"
          ? t("own")
          : info.seat === "included"
            ? t("included")
            : !seats.price
              ? t("extraNoPrice")
              : salesLive()
                ? t("extra", { price: seats.price })
                : t("extraBeforeSales", { price: seats.price })}
      </StatusPill>
    </>
  );
}
