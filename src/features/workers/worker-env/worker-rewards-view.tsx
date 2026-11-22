"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { useSession } from "@/features/account/queries";
import { MyRewards } from "../rewards/my-rewards";

/** The worker's own rewards (28.2): the month, what is coming, their plan and payouts. Read only. */
export function WorkerRewardsView() {
  const t = useTranslations("workers.myRewards");
  const { worker } = useSession();
  if (!worker) return null;

  return (
    <Stagger className="flex flex-col gap-8">
      <StaggerItem>
        <PageHeader title={t("title")} description={t("description")} />
      </StaggerItem>
      <StaggerItem>
        <MyRewards workerId={worker.id} />
      </StaggerItem>
    </Stagger>
  );
}
