"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { targetMatches, useDashboardDefaults, useWorkerWidgetList } from "@/features/dashboard/widgets/layout-queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { track } from "@/lib/analytics/client";
import { useCompanyTree, useMoveWorker } from "./company/queries";
import { OWNER_ROOT } from "./company/tree";
import { useSetGroupMember } from "./dashboard/queries";
import type { DashboardWorker } from "./dashboard/types";
import { AccessFields, useSaveInviteExtras, type InviteAccess } from "./invite-access";
import { sameGrants, templateOf } from "./permissions-catalog";
import { useSaveWorkerGrants, useWorkerGrants } from "./queries";
import { useRewardPlan } from "./rewards/queries";

/**
 * "Edit the invite" (30.2): while the person has not accepted, the owner
 * changes what they will be able to do — rights, widgets, manager, groups,
 * dashboard and, while there is none, a reward plan from a template. The
 * waiting invite in the person's app reads it live; it applies from the
 * first second after they accept.
 */
export function EditInviteDialog({
  open,
  onOpenChange,
  worker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: DashboardWorker;
}) {
  const t = useTranslations("workers.form.editInvite");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { name: worker.name })}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {open && <EditInviteBody key={generation} worker={worker} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function EditInviteBody({ worker, onDone }: { worker: DashboardWorker; onDone: () => void }) {
  const t = useTranslations("workers.form.editInvite");
  const grants = useWorkerGrants(worker.id);
  const widgets = useWorkerWidgetList(worker.id, true);
  const defaults = useDashboardDefaults(true);
  const tree = useCompanyTree();
  const plan = useRewardPlan(worker.id);
  const person = tree.data?.find((entry) => entry.id === worker.id);
  const loaded =
    grants.data !== undefined && widgets.data !== undefined && defaults.data !== undefined && tree.data !== undefined;
  const failed = grants.isError || widgets.isError || defaults.isError || tree.isError;

  const initial = useMemo<InviteAccess | null>(() => {
    if (!loaded) return null;
    const own = defaults.data!.some((row) => targetMatches(row, { kind: "worker", workerId: worker.id }));
    return {
      grants: grants.data!,
      widgets: widgets.data!,
      managerId: worker.managerId ?? OWNER_ROOT,
      groupIds: new Set(person?.groupIds ?? []),
      reward: null,
      dashboard: own ? "keep" : "auto",
    };
    // The form starts once from what is stored; later refetches do not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (failed) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!initial) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <EditInviteForm
      worker={worker}
      initial={initial}
      offerReward={!plan.data}
      canKeepDashboard={initial.dashboard === "keep"}
      onDone={onDone}
    />
  );
}

function EditInviteForm({
  worker,
  initial,
  offerReward,
  canKeepDashboard,
  onDone,
}: {
  worker: DashboardWorker;
  initial: InviteAccess;
  offerReward: boolean;
  canKeepDashboard: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("workers.form.editInvite");
  const tForm = useTranslations("workers.form");
  const [access, setAccess] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const saveGrants = useSaveWorkerGrants(worker.id);
  const saveExtras = useSaveInviteExtras();
  const move = useMoveWorker();
  const setMember = useSetGroupMember(worker);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      const rights = !sameGrants(access.grants, initial.grants);
      if (rights) {
        await saveGrants.mutateAsync({ grants: access.grants, template: templateOf(access.grants) ?? undefined });
      }
      const widgets = JSON.stringify(access.widgets) !== JSON.stringify(initial.widgets);
      const dashboard = access.dashboard !== initial.dashboard;
      if (widgets || dashboard || access.reward) {
        await saveExtras(
          worker.id,
          {
            widgets: access.widgets,
            dashboard: dashboard ? access.dashboard : "keep",
            reward: access.reward,
          },
          { editing: true },
        );
      }
      let place = false;
      if (access.managerId !== initial.managerId) {
        place = true;
        await move.mutateAsync({
          workerId: worker.id,
          managerId: access.managerId === OWNER_ROOT ? null : access.managerId,
          via: "menu",
        });
      }
      const groups = new Set([...access.groupIds, ...initial.groupIds]);
      for (const groupId of groups) {
        const member = access.groupIds.has(groupId);
        if (member === initial.groupIds.has(groupId)) continue;
        place = true;
        await setMember.mutateAsync({ groupId, member });
      }
      track("worker_invite_edited", { rights, widgets, place, dashboard });
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="edit-invite">
      <p className="text-sm text-ink-soft">{t("hint")}</p>
      <AccessFields
        value={access}
        onChange={setAccess}
        workerId={worker.id}
        offerReward={offerReward}
        canKeepDashboard={canKeepDashboard}
      />
      {failed && <FormAlert>{tForm("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {tForm("cancel")}
        </Button>
        <Button type="submit" disabled={pending} data-testid="edit-invite-save">
          {tForm("save")}
        </Button>
      </div>
    </form>
  );
}
