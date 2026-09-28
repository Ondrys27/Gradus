"use client";

import { BanknoteIcon, HourglassIcon, WalletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { StatTile } from "@/components/ui/stat-tile";
import { useSession } from "@/features/account/queries";
import { EarningsPanel } from "../earnings-panel";
import { useWorkerBalance } from "../queries";

/** What the worker earned, with its status: waiting for approval, approved, paid. */
export function WorkerRewardsView() {
  const t = useTranslations("workers.myRewards");
  const { worker } = useSession();
  const balance = useWorkerBalance(worker?.id ?? null);
  if (!worker) return null;

  return (
    <Stagger className="flex flex-col gap-8">
      <StaggerItem>
        <PageHeader title={t("title")} description={t("description")} />
      </StaggerItem>
      <StaggerItem>
        {balance.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label={t("toBePaid")}
              value={balance.data?.owed ?? 0}
              format={{ style: "currency" }}
              tone="gold"
              icon={<WalletIcon />}
            />
            <StatTile
              label={t("paidOut")}
              value={balance.data?.paidOut ?? 0}
              format={{ style: "currency" }}
              tone="green"
              icon={<BanknoteIcon />}
            />
            <StatTile
              label={t("pending")}
              value={balance.data?.pending ?? 0}
              format={{ style: "currency" }}
              tone="violet"
              icon={<HourglassIcon />}
            />
          </div>
        )}
      </StaggerItem>
      <StaggerItem>
        <EarningsPanel workerId={worker.id} canApprove={false} />
      </StaggerItem>
    </Stagger>
  );
}
