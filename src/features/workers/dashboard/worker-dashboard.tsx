"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ClipboardPlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/features/account/workspace-queries";
import { MentionedInNotes } from "@/features/notes/mentioned-in-notes";
import { track } from "@/lib/analytics/client";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { InviteCard } from "../invite-card";
import { useRenewInvite, useWorkerInvite } from "../queries";
import { WorkerTaskDialog } from "../worker-task-dialog";
import { DashboardHeader } from "./dashboard-header";
import { DocumentsTab } from "./documents-tab";
import { InfoCard } from "./info-card";
import { OverviewTab } from "./overview-tab";
import { useCompanyWorker } from "./queries";
import { RemoveZone } from "./remove-zone";
import { RewardsTab } from "./rewards-tab";
import { RightsTab } from "./rights-tab";
import { TeamTab } from "./team-tab";
import {
  DASHBOARD_TABS,
  type DashboardTab,
  type DashboardViewer,
  type DashboardWorker,
} from "./types";
import { WorkTab } from "./work-tab";

type Props = {
  /** The person shown; null closes the window. */
  workerId: string | null;
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onClose: () => void;
  /** Opens another person's dashboard (a manager, someone of the team). */
  onOpenWorker: (workerId: string) => void;
  onOpenDeal: (dealId: string) => void;
  /** Company → Groups, where groups are managed. */
  onShowGroups: () => void;
};

/** The tabs each viewer gets: the owner all, the person their own, others what they may see. */
export function tabsFor(viewer: DashboardViewer, worker: DashboardWorker): DashboardTab[] {
  if (viewer === "owner") return [...DASHBOARD_TABS];
  if (viewer === "self") return [...DASHBOARD_TABS];
  return DASHBOARD_TABS.filter(
    (tab) =>
      tab === "overview" ||
      tab === "work" ||
      tab === "team" ||
      (tab === "documents" && worker.canEdit),
  );
}

/**
 * Everything about one person of the company in a large window (the whole
 * screen on a phone): who they are, what they may do, their deals and tasks,
 * documents, team and rewards. Details save on their own, like the deal detail.
 */
export function WorkerDashboard(props: Props) {
  const t = useTranslations("workers.dashboard");
  const isPhone = useIsPhone();
  const { workerId, onClose } = props;

  // Keep the last person on screen while the window closes.
  const [shown, setShown] = useState<string | null>(workerId);
  if (workerId && workerId !== shown) setShown(workerId);
  const current = workerId ?? shown;

  return (
    <Dialog.Root open={workerId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          data-testid="worker-dashboard"
          className={cn(
            "fixed z-overlay flex flex-col overflow-hidden bg-surface shadow-popover outline-none",
            "transition-[opacity,scale,translate] duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0",
            isPhone
              ? "inset-0 pt-[env(safe-area-inset-top)] data-ending-style:translate-y-4 data-starting-style:translate-y-4"
              : "top-1/2 left-1/2 h-[min(90dvh,880px)] w-[min(100vw-32px,960px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line-strong data-ending-style:scale-[0.98] data-starting-style:scale-[0.98]",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
            <Dialog.Title className="micro-label">{t("title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-9"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {current && <DashboardBody key={current} {...props} workerId={current} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DashboardBody({
  workerId,
  tab: requestedTab,
  onTabChange,
  onOpenWorker,
  onOpenDeal,
  onShowGroups,
}: Props & { workerId: string }) {
  const t = useTranslations("workers.dashboard");
  const workspace = useWorkspace();
  const query = useCompanyWorker(workerId);
  const worker = query.data;
  const viewer: DashboardViewer =
    workspace.role === "owner" ? "owner" : worker?.isSelf ? "self" : "other";
  const tabs = worker ? tabsFor(viewer, worker) : [];
  const tab = tabs.includes(requestedTab) ? requestedTab : "overview";

  // Once per opening, with the tab it opened on.
  const opened = useRef(false);
  useEffect(() => {
    if (!worker || opened.current) return;
    opened.current = true;
    track("worker_dashboard_opened", { tab, viewer });
  }, [worker, tab, viewer]);

  if (query.isError) {
    return (
      <div className="p-6">
        <FormAlert>{t("loadFailed")}</FormAlert>
      </div>
    );
  }
  if (!worker) {
    if (query.isPending) {
      return (
        <div className="flex flex-col gap-4 p-6" aria-hidden>
          <div className="flex items-center gap-4">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-8 w-56" />
          </div>
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      );
    }
    return (
      <div className="p-6">
        <EmptyState title={t("notFoundTitle")} description={t("notFoundDescription")} />
      </div>
    );
  }

  return (
    <>
      <div className="shrink-0 px-4 pb-0 sm:px-6">
        <DashboardHeader
          worker={worker}
          viewer={viewer}
          actions={viewer === "owner" ? <AssignTaskButton worker={worker} /> : undefined}
        />
        <div
          role="tablist"
          aria-label={t("sections")}
          className="-mx-1 mt-4 flex overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
        >
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`worker-tab-${key}`}
              data-testid={`worker-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`worker-panel-${key}`}
              onClick={() => onTabChange(key)}
              className={cn(
                "relative min-h-11 shrink-0 cursor-pointer px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                tab === key ? "font-semibold text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {t(`tabs.${key}`)}
              {tab === key && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-violet"
                />
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`worker-panel-${tab}`}
        aria-labelledby={`worker-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain border-t border-line px-4 pt-5 pb-[calc(24px+env(safe-area-inset-bottom))] sm:px-6"
      >
        {tab === "overview" && (
          <>
            {viewer === "owner" && worker.status === "invited" && <OwnerInvite worker={worker} />}
            <InfoCard
              worker={worker}
              viewer={viewer}
              readOnly={workspace.readOnly}
              onShowGroups={onShowGroups}
            />
            <OverviewTab worker={worker} />
            {viewer === "owner" && <MentionedInNotes kind="worker" id={worker.id} card />}
            {viewer === "owner" && worker.status !== "inactive" && (
              <RemoveZone worker={worker} readOnly={workspace.readOnly} />
            )}
          </>
        )}
        {tab === "rights" && <RightsTab worker={worker} viewer={viewer} />}
        {tab === "work" && <WorkTab worker={worker} onOpenDeal={onOpenDeal} />}
        {tab === "documents" && <DocumentsTab worker={worker} />}
        {tab === "team" && <TeamTab worker={worker} viewer={viewer} onOpenWorker={onOpenWorker} />}
        {tab === "rewards" && <RewardsTab worker={worker} viewer={viewer} />}
      </div>
    </>
  );
}

/** The invite link of someone who has not signed up yet, with a fresh one on request. */
function OwnerInvite({ worker }: { worker: DashboardWorker }) {
  const invite = useWorkerInvite(worker.id);
  const renew = useRenewInvite(worker.id);
  if (!invite.data) return null;
  return (
    <InviteCard
      invite={invite.data}
      workerName={worker.name}
      onRenew={() => renew.mutate(worker.email)}
      renewing={renew.isPending}
      renewFailed={renew.isError}
    />
  );
}

/** The owner gives the person a task of their own (worker_tasks). */
function AssignTaskButton({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers.dashboard");
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  if (worker.status === "inactive" || workspace.readOnly) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ClipboardPlusIcon aria-hidden data-icon="inline-start" />
        {t("assignTask")}
      </Button>
      <WorkerTaskDialog open={open} onOpenChange={setOpen} workerId={worker.id} task={null} />
    </>
  );
}
