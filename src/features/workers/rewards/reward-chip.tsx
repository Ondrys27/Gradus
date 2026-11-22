"use client";

import { GiftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";

/** The reward for completing a task, on its row (28.2); nothing without one. */
export function RewardChip({
  amount,
  currency,
}: {
  amount: number | null | undefined;
  currency: string | null | undefined;
}) {
  const t = useTranslations("workers.rewardPrice");
  const settings = useFormatSettings();
  if (amount == null || !currency) return null;
  const price = formatPrice(Number(amount), currency, settings);
  return (
    <StatusPill tone="gold" title={t("readOnly", { amount: price })} data-testid="task-reward-chip">
      <GiftIcon aria-hidden />
      {price}
    </StatusPill>
  );
}
