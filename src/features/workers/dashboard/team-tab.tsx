"use client";

import { useMemo } from "react";
import { ChevronRightIcon, CrownIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PersonStatus } from "../company/person-bits";
import { useCompanyTree } from "../company/queries";
import { buildCompanyTree, flattenCompanyTree, type CompanyPerson } from "../company/tree";
import type { DashboardViewer, DashboardWorker } from "./types";

/** The people around the person: their manager, who reports to them and their whole branch. */
export function teamOf(people: readonly CompanyPerson[], workerId: string) {
  const branch = flattenCompanyTree(buildCompanyTree(people, workerId), new Set())
    .filter((row) => row.depth > 0 && row.node.person)
    .map((row) => ({ person: row.node.person!, depth: row.depth }));
  const direct = branch.filter((row) => row.depth === 1).map((row) => row.person);
  return { direct, branch };
}

export function TeamTab({
  worker,
  viewer,
  onOpenWorker,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
  onOpenWorker: (workerId: string) => void;
}) {
  const t = useTranslations("workers.dashboard.team");
  const settings = useFormatSettings();
  const people = useCompanyTree();
  const team = useMemo(
    () => (people.data ? teamOf(people.data, worker.id) : null),
    [people.data, worker.id],
  );
  const manager = worker.managerId
    ? people.data?.find((person) => person.id === worker.managerId)
    : undefined;

  if (people.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!team) return <Skeleton className="h-64 rounded-card" />;

  return (
    <div className="flex flex-col gap-6" data-testid="worker-team">
      <section className="flex flex-col gap-2" aria-labelledby="worker-team-manager">
        <h3 id="worker-team-manager" className="micro-label">
          {t("manager")}
        </h3>
        {manager ? (
          <PersonRow person={manager} onOpen={() => onOpenWorker(manager.id)} />
        ) : (
          <p className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
            <CrownIcon aria-hidden className="size-4 text-gold" />
            {viewer === "owner" ? t("underYou") : t("underOwner")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="worker-team-direct">
        <h3 id="worker-team-direct" className="micro-label">
          {t("direct", {
            count: team.direct.length,
            shown: formatNumber(team.direct.length, {}, settings),
          })}
        </h3>
        {team.direct.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title={t("emptyTitle")} description={t("empty")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {team.direct.map((person) => (
              <li key={person.id}>
                <PersonRow person={person} onOpen={() => onOpenWorker(person.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {team.branch.length > team.direct.length && (
        <section className="flex flex-col gap-2" aria-labelledby="worker-team-branch">
          <h3 id="worker-team-branch" className="micro-label">
            {t("branch", { shown: formatNumber(team.branch.length, {}, settings) })}
          </h3>
          <ul className="flex flex-col gap-1">
            {team.branch.map(({ person, depth }) => (
              <li key={person.id} style={{ paddingLeft: Math.min(depth - 1, 8) * 20 }}>
                <PersonRow person={person} onOpen={() => onOpenWorker(person.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PersonRow({ person, onOpen }: { person: CompanyPerson; onOpen: () => void }) {
  const t = useTranslations("workers.dashboard.team");
  const tCard = useTranslations("workers.card");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("open", { name: person.name })}
      data-testid="worker-team-person"
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-2 text-left outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
    >
      <Avatar src={person.avatarUrl} name={person.name} className="size-9" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-ink">{person.name}</span>
        <span className="truncate text-xs text-ink-muted">
          {person.jobTitle ?? tCard("noJobTitle")}
        </span>
      </span>
      {person.status !== "active" && <PersonStatus status={person.status} />}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
    </button>
  );
}
