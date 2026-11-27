"use client";

import { useMemo, useState } from "react";
import { BanknoteIcon, CheckCheckIcon, CoinsIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/features/account/workspace-queries";
import { formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PayoutDialog, type PayoutRequest } from "../rewards/entry-dialogs";
import { PayoutHistory, useExportPayouts } from "../rewards/payouts-panel";
import { useOpenEntries, useReviewEntries, useRewardTotals } from "../rewards/queries";
import { RewardsTiles } from "../rewards/rewards-tiles";
import { payoutGroups, totalsByCurrency } from "../rewards/summary";
import type { RewardTotals } from "../rewards/types";
import type { CompanyPerson } from "./tree";

/**
 * Rewards and payouts of everyone at once (28.2): this month's earnings, what
 * waits for approval and for the payout, and what is planned, per person;
 * approve and pay out several people in one go. Only the people of the
 * company now; a manager with "company: rewards" sees the people they see in
 * Company, never themself. "Show former too" adds the people who worked here
 * and left (their history and what is still owed), marked, without selection.
 * A row opens the person's rewards.
 */
export function CompanyRewards({
  people,
  failed,
  onOpen,
}: {
  people: CompanyPerson[] | undefined;
  failed: boolean;
  onOpen: (workerId: string) => void;
}) {
  const t = useTranslations("workers.rewardPlan.company");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const totals = useRewardTotals(null);
  const open = useOpenEntries();
  const review = useReviewEntries("company");
  const exportCsv = useExportPayouts();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [exportFailed, setExportFailed] = useState(false);
  const [showFormer, setShowFormer] = useState(false);
  const canChange = !workspace.readOnly;

  const roster = useMemo(
    () =>
      (people ?? []).filter(
        (person) => person.status === "active" && person.id !== workspace.workerId,
      ),
    [people, workspace.workerId],
  );
  // Worked here (an account joined) and left; never an invite nobody accepted.
  const former = useMemo(
    () =>
      showFormer
        ? (people ?? []).filter(
            (person) =>
              person.status === "inactive" && person.userId !== null && person.id !== workspace.workerId,
          )
        : [],
    [people, showFormer, workspace.workerId],
  );
  const rows = useMemo(
    () => [
      ...roster.map((person) => ({ person, former: false })),
      ...former.map((person) => ({ person, former: true })),
    ],
    [roster, former],
  );
  const names = useMemo(() => new Map((people ?? []).map((person) => [person.id, person.name])), [people]);
  const nameOf = (id: string) => names.get(id) ?? t("former");
  const byWorker = useMemo(() => {
    const map = new Map<string, RewardTotals[]>();
    for (const item of totals.data ?? []) map.set(item.workerId, [...(map.get(item.workerId) ?? []), item]);
    return map;
  }, [totals.data]);
  const rosterIds = new Set(roster.map((person) => person.id));
  const companyTotals = (totals.data ?? []).filter((item) => rosterIds.has(item.workerId));
  const mainCurrency = totalsByCurrency(companyTotals)[0]?.currency ?? settings.currency;

  const chosen = roster.filter((person) => selected.has(person.id));
  const chosenEntries = (open.data ?? []).filter((entry) => selected.has(entry.worker_id));
  const pendingIds = chosenEntries.filter((entry) => entry.status === "pending" && !entry.corrects_id).map((entry) => entry.id);
  const payable: PayoutRequest[] = chosen.flatMap((person) =>
    payoutGroups(chosenEntries.filter((entry) => entry.worker_id === person.id))
      .filter((group) => group.total > 0)
      .map((group) => ({ workerId: person.id, name: person.name, ...group })),
  );

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (failed || totals.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;

  return (
    <div className="flex flex-col gap-5" data-testid="company-rewards">
      <p className="max-w-2xl text-sm text-ink-soft">{t("description")}</p>
      <RewardsTiles totals={totals.data ? companyTotals : undefined} isError={false} currency={mainCurrency} />

      <GlowCard interactive={false} className="flex flex-col gap-4" data-tutorial="reward-team">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-soft">
            {canChange && roster.length > 0 && (
              <Checkbox
                checked={roster.length > 0 && chosen.length === roster.length}
                indeterminate={chosen.length > 0 && chosen.length < roster.length}
                onCheckedChange={(on) =>
                  setSelected(on === true ? new Set(roster.map((person) => person.id)) : new Set())
                }
                aria-label={t("selectAll")}
              />
            )}
            {chosen.length > 0 ? t("selected", { count: chosen.length }) : t("people", { count: roster.length })}
          </label>
          {canChange && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"
                variant="outline"
                disabled={pendingIds.length === 0 || review.isPending}
                onClick={() => review.mutate({ ids: pendingIds, action: "approve" })}
                data-testid="company-rewards-approve"
                data-tutorial="reward-approve"
              >
                <CheckCheckIcon aria-hidden data-icon="inline-start" />
                {t("approve", { count: pendingIds.length })}
              </Button>
              <Button
                size="sm"
                disabled={payable.length === 0}
                onClick={() => setRequests(payable)}
                data-testid="company-rewards-pay"
                data-tutorial="reward-pay"
              >
                <BanknoteIcon aria-hidden data-icon="inline-start" />
                {t("pay", { count: payable.length })}
              </Button>
            </div>
          )}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-ink-soft">
          <Switch checked={showFormer} onCheckedChange={setShowFormer} data-testid="company-rewards-former" />
          {t("showFormer")}
        </label>
        {review.isError && <FormAlert>{t("reviewFailed")}</FormAlert>}

        {!people || !totals.data ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CoinsIcon />} title={t("empty")} />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="w-10 px-2 py-2 font-normal" />
                  <th className="px-2 py-2 font-normal">{t("columns.person")}</th>
                  <th className="px-2 py-2 text-right font-normal">{t("columns.earned")}</th>
                  <th className="px-2 py-2 text-right font-normal">{t("columns.pending")}</th>
                  <th className="px-2 py-2 text-right font-normal">{t("columns.approved")}</th>
                  <th className="px-2 py-2 text-right font-normal">{t("columns.planned")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {rows.map(({ person, former: isFormer }) => {
                  const own = byWorker.get(person.id) ?? [];
                  const cell = (pick: (item: RewardTotals) => number) =>
                    own.length === 0
                      ? "—"
                      : own
                          .filter((item) => pick(item) !== 0)
                          .map((item) => formatPrice(pick(item), item.currency, settings))
                          .join(" · ") || "—";
                  return (
                    <tr key={person.id} data-testid="company-rewards-row">
                      <td className="px-2 py-2">
                        {canChange && !isFormer && (
                          <Checkbox
                            checked={selected.has(person.id)}
                            onCheckedChange={(on) => toggle(person.id, on === true)}
                            aria-label={t("select", { name: person.name })}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          data-tutorial="reward-person"
                          onClick={() => onOpen(person.id)}
                          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
                        >
                          <Avatar
                            src={person.avatarUrl}
                            name={person.name}
                            presenceOf={person.userId}
                            className="size-8"
                          />
                          <span className="flex flex-col">
                            <span className="font-medium text-ink">{person.name}</span>
                            {isFormer ? (
                              <StatusPill tone="neutral" className="self-start">
                                {t("former")}
                              </StatusPill>
                            ) : (
                              person.jobTitle && <span className="text-xs text-ink-muted">{person.jobTitle}</span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{cell((item) => item.earned)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-violet">{cell((item) => item.pending)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-teal">{cell((item) => item.approved)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{cell((item) => item.planned)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlowCard>

      <GlowCard interactive={false} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-ink">{t("payouts")}</h3>
          <Button
            size="sm"
            variant="outline"
            data-tutorial="reward-export"
            onClick={() => {
              setExportFailed(false);
              exportCsv(null, nameOf).catch(() => setExportFailed(true));
            }}
          >
            <DownloadIcon aria-hidden data-icon="inline-start" />
            {t("export")}
          </Button>
        </div>
        {exportFailed && <FormAlert>{t("exportFailed")}</FormAlert>}
        <PayoutHistory workerId={null} nameOf={nameOf} />
      </GlowCard>

      <PayoutDialog
        requests={requests}
        from="company"
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRequests([]);
            setSelected(new Set());
          }
        }}
      />
    </div>
  );
}
