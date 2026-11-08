"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { priceCurrencyFor } from "@/config/pricing";
import { useSession, useUserSettings } from "@/features/account/queries";
import { workerSeats, type Seat } from "@/features/plan/worker-seats";
import { money } from "@/features/subscription/plan-price";
import { useWorkerBilling } from "@/features/subscription/queries";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { WorkerStatus } from "../types";

type SeatInfo = { seat: Seat | null; declined: boolean; pendingAccount: boolean };

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
        pendingAccount: row.pendingAccount,
      });
    }
    const currency = priceCurrencyFor(settings.currency);
    const price = terms.perWorker ? money(terms.perWorker[currency], currency, format) : null;
    return { seats: out, price };
  }, [query.data, settings.currency, format]);
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
      >
        {info.seat === "own"
          ? t("own")
          : info.seat === "included"
            ? t("included")
            : seats.price
              ? t("extra", { price: seats.price })
              : t("extraNoPrice")}
      </StatusPill>
    </>
  );
}
