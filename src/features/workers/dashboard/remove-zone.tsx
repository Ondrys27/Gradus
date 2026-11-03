"use client";

import { useMemo, useState } from "react";
import { UserMinusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, useSession } from "@/features/account/queries";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useCompanyTree } from "../company/queries";
import { dashboardErrorOf, useRemoveWorker, useWorkerImpact } from "./queries";
import type { DashboardWorker } from "./types";

const OWNER = "owner";
const NOBODY = "nobody";

/**
 * Who can take over the deals and tasks of a person who leaves: the owner
 * first, then every active worker with an account, never the person.
 */
export function handoverChoices(
  people: readonly { id: string; name: string; status: string; userId: string | null }[],
  leaving: string,
): { id: string; name: string; userId: string }[] {
  return people
    .filter((person) => person.id !== leaving && person.status === "active" && person.userId)
    .map((person) => ({ id: person.id, name: person.name, userId: person.userId! }));
}

/**
 * The red zone at the end of the overview (owner only). Removing ends the
 * person's access at once; their data stays and they show as ended. What they
 * look after can go to the owner or another worker in the same step.
 */
export function RemoveZone({ worker, readOnly }: { worker: DashboardWorker; readOnly: boolean }) {
  const t = useTranslations("workers.dashboard.remove");
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={`worker-remove-${worker.id}`}
      className="flex flex-col gap-3 rounded-card border border-destructive/40 bg-destructive/5 p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`worker-remove-${worker.id}`} className="text-sm font-semibold text-destructive">
          {t("zoneTitle")}
        </h3>
        <p className="text-sm text-ink-soft">{t("zoneDescription")}</p>
      </div>
      <Button
        variant="destructive"
        className="self-start"
        data-testid="worker-remove"
        onClick={() => setOpen(true)}
      >
        <UserMinusIcon aria-hidden data-icon="inline-start" />
        {t("button")}
      </Button>
      <RemoveDialog worker={worker} readOnly={readOnly} open={open} onOpenChange={setOpen} />
    </section>
  );
}

function RemoveDialog({
  worker,
  readOnly,
  open,
  onOpenChange,
}: {
  worker: DashboardWorker;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("workers.dashboard.remove");
  const tErrors = useTranslations("workers.dashboard.errors");
  const settings = useFormatSettings();
  const { user } = useSession();
  const profile = useProfile();
  const impact = useWorkerImpact(worker.id, open);
  const people = useCompanyTree();
  const remove = useRemoveWorker(worker.id);
  const [target, setTarget] = useState<string>(OWNER);

  const options = useMemo(
    () => [
      { value: OWNER, label: t("toOwner", { name: profile.display_name || t("you") }) },
      ...handoverChoices(people.data ?? [], worker.id).map((person) => ({
        value: person.userId,
        label: person.name,
      })),
      { value: NOBODY, label: t("toNobody") },
    ],
    [people.data, worker.id, profile.display_name, t],
  );

  const data = impact.data;
  const inCare = data ? data.openDeals + data.openCrmTasks + data.openWorkerTasks : 0;
  const handOver = !readOnly && inCare > 0;
  const choice = handOver ? target : NOBODY;
  const n = (value: number) => formatNumber(value, {}, settings);

  function confirm() {
    const assignee = choice === OWNER ? user.id : choice === NOBODY ? null : choice;
    remove.mutate(
      { assignee, to: choice === OWNER ? "owner" : choice === NOBODY ? "nobody" : "worker" },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
      title={t("title", { name: worker.name })}
      closeLabel={t("cancel")}
    >
      <div className="flex flex-col gap-5" data-testid="worker-remove-dialog">
        <p className="text-sm text-ink-soft">{t("description")}</p>

        {impact.isError ? (
          <FormAlert>{t("impactFailed")}</FormAlert>
        ) : !data ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : inCare === 0 ? (
          <p className="text-sm text-ink-soft">{t("nothingInCare")}</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-xl border border-line p-3 text-sm text-ink">
            <li>{t("deals", { count: data.openDeals, shown: n(data.openDeals) })}</li>
            <li>{t("crmTasks", { count: data.openCrmTasks, shown: n(data.openCrmTasks) })}</li>
            <li>
              {t("workerTasks", { count: data.openWorkerTasks, shown: n(data.openWorkerTasks) })}
            </li>
          </ul>
        )}

        {handOver && (
          <div className="flex flex-col gap-2">
            <span id="worker-remove-assignee-label" className="text-sm font-medium text-ink-soft">
              {t("handTo")}
            </span>
            <Select
              value={target}
              items={options}
              onValueChange={(next) => {
                if (typeof next === "string") setTarget(next);
              }}
            >
              <SelectTrigger
                aria-labelledby="worker-remove-assignee-label"
                data-testid="worker-remove-assignee"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data && data.openWorkerTasks > 0 && target === OWNER && (
              <p className="text-xs text-ink-muted">{t("workerTasksStay")}</p>
            )}
          </div>
        )}
        {readOnly && inCare > 0 && <p className="text-xs text-ink-muted">{t("readOnlyHint")}</p>}

        {remove.isError && <FormAlert>{tErrors(dashboardErrorOf(remove.error))}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="worker-remove-confirm"
            disabled={remove.isPending || !data}
            onClick={confirm}
          >
            {t("confirm")}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
