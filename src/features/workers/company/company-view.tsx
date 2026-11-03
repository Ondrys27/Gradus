"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2Icon, ListTreeIcon, NetworkIcon, UserPlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { Segmented } from "@/features/finance/segmented";
import { MarkSeenOnVisit } from "@/features/game/mark-seen-on-visit";
import { useViewTracking } from "@/lib/analytics/use-view-tracking";
import { createViewPreference } from "@/lib/view-preference";
import { cn } from "@/lib/utils";
import { WorkerFormDialog } from "../worker-form-dialog";
import { CompanyGroups } from "./company-groups";
import { CompanyList, type CompanyViewer } from "./company-list";
import { CompanyMap } from "./company-map";
import { CompanyRewards } from "./company-rewards";
import { MoveWorkerDialog } from "./move-worker-dialog";
import {
  companyErrorOf,
  useCompanyGroups,
  useCompanyTree,
  useMoveWorker,
  type CompanyError,
} from "./queries";
import { WorkerDashboard } from "../dashboard/worker-dashboard";
import {
  companySearchString,
  matchesStatus,
  parseCompanySearch,
  STATUS_FILTERS,
  type CompanySearch,
  type StatusFilter,
} from "./search";
import {
  buildCompanyTree,
  groupFilter,
  OWNER_ROOT,
  planManagerMove,
  pruneTree,
  type CompanyPerson,
} from "./tree";

type CompanyLayout = "list" | "map";
/** List or map, remembered per device like the milestone tasks. */
const useCompanyLayout = createViewPreference<CompanyLayout>(
  "gradus.company.view",
  ["list", "map"],
  "list",
);

const ALL_GROUPS = "all";

/**
 * Company: the people of the firm as a tree under the owner, as a list or an
 * org chart, with groups, invites and everyone's rewards. The owner sees and
 * changes all of it; a worker sees their own branch, read only.
 */
export function CompanyView() {
  const t = useTranslations("workers");
  const tc = useTranslations("workers.company");
  const tNav = useTranslations("nav");
  const tSections = useTranslations("sections.workers");
  const workspace = useWorkspace();
  const { worker } = useSession();
  const profile = useProfile();
  const isOwner = workspace.role === "owner";
  const canEdit = isOwner && !workspace.readOnly;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const {
    tab: requestedTab,
    group: requestedGroup,
    status,
    worker: openWorker,
    workerTab,
  } = useMemo(() => parseCompanySearch(new URLSearchParams(search)), [search]);
  const tab = isOwner ? requestedTab : "people";
  function replaceSearch(next: Partial<CompanySearch>) {
    const text = companySearchString(new URLSearchParams(search), next);
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const people = useCompanyTree();
  const groups = useCompanyGroups();
  const [inviting, setInviting] = useState(false);

  const viewer: CompanyViewer = useMemo(
    () =>
      isOwner || !worker
        ? {
            kind: "owner",
            name: profile.display_name ?? tc("ownerRole"),
            avatarUrl: profile.avatar_url,
          }
        : { kind: "worker", workerId: worker.id },
    [isOwner, worker, profile.display_name, profile.avatar_url, tc],
  );

  return (
    <Stagger className="flex flex-col gap-6">
      {isOwner && <MarkSeenOnVisit section="workers" />}
      <StaggerItem>
        <PageHeader
          title={tNav("workers")}
          description={tSections("description")}
          actions={
            canEdit ? (
              <Button onClick={() => setInviting(true)}>
                <UserPlusIcon aria-hidden data-icon="inline-start" />
                {t("add")}
              </Button>
            ) : undefined
          }
        />
      </StaggerItem>

      {isOwner && (
        <StaggerItem>
          <Segmented
            label={tc("tabs.label")}
            value={tab}
            options={[
              { value: "people", label: tc("tabs.people") },
              { value: "groups", label: tc("tabs.groups") },
              { value: "rewards", label: tc("tabs.rewards") },
            ]}
            onChange={(next) => replaceSearch({ tab: next })}
          />
        </StaggerItem>
      )}

      <StaggerItem>
        {tab === "people" ? (
          <CompanyPeople
            people={people.data}
            failed={people.isError || groups.isError}
            groups={groups.data}
            groupId={requestedGroup}
            onGroupChange={(group) => replaceSearch({ group })}
            status={status}
            onStatusChange={(next) => replaceSearch({ status: next })}
            onOpen={(person) => replaceSearch({ worker: person.id, workerTab: "overview" })}
            viewer={viewer}
            canEdit={canEdit}
            onInvite={canEdit ? () => setInviting(true) : undefined}
          />
        ) : tab === "groups" ? (
          <CompanyGroups
            people={people.data}
            groups={groups.data}
            failed={people.isError || groups.isError}
            canEdit={canEdit}
            onShow={(group) => replaceSearch({ tab: "people", group })}
          />
        ) : (
          <CompanyRewards />
        )}
      </StaggerItem>

      {canEdit && <WorkerFormDialog open={inviting} onOpenChange={setInviting} worker={null} />}
      <WorkerDashboard
        workerId={openWorker}
        tab={workerTab}
        onTabChange={(next) => replaceSearch({ workerTab: next })}
        onClose={() => replaceSearch({ worker: null })}
        onOpenWorker={(id) => replaceSearch({ worker: id, workerTab: "overview" })}
        onOpenDeal={(dealId) => router.push(`/app/pipeline?deal=${encodeURIComponent(dealId)}`)}
        onShowGroups={() => replaceSearch({ worker: null, tab: "groups" })}
      />
    </Stagger>
  );
}

function CompanyPeople({
  people,
  failed,
  groups,
  groupId,
  onGroupChange,
  status,
  onStatusChange,
  onOpen,
  viewer,
  canEdit,
  onInvite,
}: {
  people: CompanyPerson[] | undefined;
  failed: boolean;
  groups: ReturnType<typeof useCompanyGroups>["data"];
  groupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  onOpen: (person: CompanyPerson) => void;
  viewer: CompanyViewer;
  canEdit: boolean;
  onInvite?: () => void;
}) {
  const t = useTranslations("workers");
  const tc = useTranslations("workers.company");
  const tSections = useTranslations("sections.workers");
  const [layout, setLayout] = useCompanyLayout();
  useViewTracking("company", layout);
  const move = useMoveWorker();
  const [error, setError] = useState<CompanyError | null>(null);
  const [moving, setMoving] = useState<{ open: boolean; person: CompanyPerson | null }>({
    open: false,
    person: null,
  });

  const groupMap = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
  const activeGroup = groupId && groupMap.has(groupId) ? groupId : null;
  const rootId = viewer.kind === "owner" ? OWNER_ROOT : viewer.workerId;

  const shown = useMemo(() => {
    if (!people) return null;
    // Ended people only through the status filter; the viewer's own row always stays.
    const listed = people.filter(
      (person) => person.id === rootId || matchesStatus(person.status, status),
    );
    const tree = buildCompanyTree(listed, rootId);
    const filter = groupFilter(listed, activeGroup);
    if (!filter) return { root: tree, context: null, matches: listed.length };
    const keep = new Set([...filter.members, ...filter.context]);
    return { root: pruneTree(tree, keep), context: filter.context, matches: filter.members.size };
  }, [people, rootId, activeGroup, status]);

  function moveWorker(workerId: string, managerId: string | null, via: "list" | "map" | "menu") {
    if (!people || !canEdit) return;
    const plan = planManagerMove(people, workerId, managerId ?? OWNER_ROOT);
    if (!plan.ok) {
      setError(plan.error === "cycle" ? "cycle" : "saveFailed");
      return;
    }
    if (!plan.changed) return;
    setError(null);
    move.mutate(
      { workerId, managerId: plan.managerId, via },
      { onError: (cause) => setError(companyErrorOf(cause)) },
    );
  }

  if (failed) return <FormAlert>{tc("errors.loadFailed")}</FormAlert>;
  if (!people || !shown || !groups) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  const workerMissing = viewer.kind === "worker" && !people.some((p) => p.id === viewer.workerId);
  if (people.length === 0 || workerMissing) {
    return (
      <EmptyState
        icon={<Building2Icon />}
        title={viewer.kind === "owner" ? tc("empty.title") : tSections("emptyTitle")}
        description={viewer.kind === "owner" ? tc("empty.description") : undefined}
        action={
          onInvite ? (
            <Button onClick={onInvite}>
              <UserPlusIcon aria-hidden data-icon="inline-start" />
              {t("add")}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const groupOptions = [
    { value: ALL_GROUPS, label: tc("filter.all") },
    ...(groups ?? []).map((group) => ({ value: group.id, label: group.name })),
  ];
  const viewProps = {
    root: shown.root,
    people,
    groups: groupMap,
    context: shown.context,
    viewer,
    canEdit,
    onMove: moveWorker,
    onOpen,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {groupOptions.length > 1 ? (
          <div className="flex min-w-0 items-center gap-2">
            <span id="company-group-filter" className="sr-only">
              {tc("filter.label")}
            </span>
            <Select
              value={activeGroup ?? ALL_GROUPS}
              items={groupOptions}
              onValueChange={(next) =>
                onGroupChange(typeof next === "string" && next !== ALL_GROUPS ? next : null)
              }
            >
              <SelectTrigger
                aria-labelledby="company-group-filter"
                data-testid="company-group-filter"
                className="min-w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groupOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <StatusSelect value={status} onChange={onStatusChange} />
          <LayoutSwitch value={layout} onChange={setLayout} />
        </div>
      </div>

      {viewer.kind === "worker" && <p className="text-sm text-ink-muted">{tc("workerNote")}</p>}
      {error && <FormAlert>{tc(`errors.${error}`)}</FormAlert>}
      {status !== "current" && shown.matches === 0 && !activeGroup && (
        <p className="text-sm text-ink-muted">{tc("filteredEmpty")}</p>
      )}
      {activeGroup && shown.matches === 0 && (
        <p className="text-sm text-ink-muted">{tc("filteredEmpty")}</p>
      )}

      {layout === "map" ? (
        <CompanyMap {...viewProps} />
      ) : (
        <CompanyList {...viewProps} onMoveMenu={(person) => setMoving({ open: true, person })} />
      )}

      {canEdit && (
        <MoveWorkerDialog
          open={moving.open}
          onOpenChange={(open) => setMoving((current) => ({ ...current, open }))}
          people={people}
          worker={moving.person}
          ownerName={viewer.kind === "owner" ? viewer.name : ""}
          ownerAvatar={viewer.kind === "owner" ? viewer.avatarUrl : null}
          onMove={(managerId) => {
            if (moving.person) moveWorker(moving.person.id, managerId, "menu");
          }}
        />
      )}
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}) {
  const t = useTranslations("workers.dashboard.statusFilter");
  const options = STATUS_FILTERS.map((option) => ({ value: option, label: t(option) }));
  return (
    <>
      <span id="company-status-filter" className="sr-only">
        {t("label")}
      </span>
      <Select
        value={value}
        items={options}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next as StatusFilter);
        }}
      >
        <SelectTrigger
          aria-labelledby="company-status-filter"
          data-testid="company-status-filter"
          className="min-w-36"
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
    </>
  );
}

function LayoutSwitch({
  value,
  onChange,
}: {
  value: CompanyLayout;
  onChange: (value: CompanyLayout) => void;
}) {
  const t = useTranslations("workers.company.view");
  const options = [
    { value: "list", icon: ListTreeIcon },
    { value: "map", icon: NetworkIcon },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex rounded-xl border border-line bg-canvas-deep/40 p-0.5"
    >
      {options.map(({ value: option, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-muted transition-colors outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
            value === option && "bg-surface-hover text-ink shadow-glow",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {t(option)}
        </button>
      ))}
    </div>
  );
}
