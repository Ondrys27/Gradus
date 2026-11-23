"use client";

import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { contactName } from "@/features/contacts/types";
import { useAssignees } from "@/features/crm-tasks/queries";
import { useCompanyTree } from "@/features/workers/company/queries";
import type { CompanyPerson } from "@/features/workers/company/tree";
import { WorkTimerCard } from "@/features/workers/worker-env/work-timer-card";
import { formatDateTime, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { COMPANY_PATH } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  combine,
  defineWidget,
  Empty,
  Hint,
  READY,
  Row,
  RowList,
  BigValue,
  type WidgetQuery,
} from "../kit";

// ---------------------------------------------------------------------------
// Work timer of a worker (their own time in the company)
// ---------------------------------------------------------------------------

function WorkTimer() {
  const { worker } = useSession();
  return worker ? <WorkTimerCard workerId={worker.id} bare /> : null;
}

export const workTimerWidget = defineWidget<true>({
  key: "workTimer",
  useData: () => READY,
  View: () => <WorkTimer />,
  Detail: () => <WorkTimer />,
});

// ---------------------------------------------------------------------------
// Team: who has what open (company_tree counts, only the branch a worker sees)
// ---------------------------------------------------------------------------

type TeamData = { people: CompanyPerson[] };

function useTeam(): WidgetQuery<TeamData> {
  const tree = useCompanyTree();
  return combine([tree], () => ({
    people: (tree.data ?? [])
      .filter((person) => person.status === "active")
      .sort(
        (a, b) =>
          b.openTasks + b.openDeals - (a.openTasks + a.openDeals) || a.name.localeCompare(b.name),
      ),
  }));
}

function PersonRow({ person }: { person: CompanyPerson }) {
  const t = useTranslations("dashboard.widgets.team");
  const format = useFormatSettings();
  return (
    <Row
      href={`${COMPANY_PATH}?worker=${person.id}`}
      trail={
        <span className="text-ink-soft">
          {t("load", {
            tasks: formatNumber(person.openTasks, {}, format),
            deals: formatNumber(person.openDeals, {}, format),
          })}
        </span>
      }
    >
      {person.name}
    </Row>
  );
}

export const teamWidget = defineWidget<TeamData>({
  key: "team",
  useData: useTeam,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.team");
    if (data.people.length === 0) {
      return (
        <Empty
          icon={UsersRoundIcon}
          tone="teal"
          title={t("emptyTitle")}
          hint={t("emptyHint")}
          action={{ label: t("invite"), href: COMPANY_PATH }}
          compact={size === "M"}
        />
      );
    }
    if (size === "M") {
      const busiest = data.people[0];
      return (
        <div className="flex flex-col gap-1.5">
          <BigValue>{data.people.length}</BigValue>
          <Hint>
            {t("busiest", { name: busiest.name, count: busiest.openTasks + busiest.openDeals })}
          </Hint>
        </div>
      );
    }
    return (
      <ul className={cn("grid gap-x-6", size === "XL" && "@3xl:grid-cols-2")}>
        {data.people.slice(0, size === "XL" ? 10 : 5).map((person) => (
          <PersonRow key={person.id} person={person} />
        ))}
      </ul>
    );
  },
  Detail: ({ data }) => (
    <RowList>
      {data.people.map((person) => (
        <PersonRow key={person.id} person={person} />
      ))}
    </RowList>
  ),
});

// ---------------------------------------------------------------------------
// Activity in the company: the latest calls, e-mails, meetings and moves of
// contacts, with who did them. 28.7 brings the full activity log; until then
// the contacts' history (contact_activities) is the source, through RLS.
// ---------------------------------------------------------------------------

const ACTIVITY_LIMIT = 20;

type ActivityItem = {
  id: string;
  type: string;
  occurred_at: string;
  actor_id: string | null;
  contact_id: string;
  contactName: string;
};

function useActivity(): WidgetQuery<{ items: ActivityItem[]; names: Map<string, string> }> {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const people = useAssignees();
  const query = useQuery({
    queryKey: ["dashboard", user.id, "activity", workspaceId],
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await createClient()
        .from("contact_activities")
        .select(
          "id, type, occurred_at, actor_id, contact_id, contact:contacts(company_name, first_name, last_name)",
        )
        .eq("user_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .limit(ACTIVITY_LIMIT);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        type: row.type,
        occurred_at: row.occurred_at,
        actor_id: row.actor_id,
        contact_id: row.contact_id,
        contactName: row.contact ? contactName(row.contact) : "",
      }));
    },
  });
  return combine([query, people], () => ({
    items: query.data!,
    names: new Map((people.data ?? []).map((person) => [person.userId, person.name])),
  }));
}

function ActivityRow({ item, names }: { item: ActivityItem; names: Map<string, string> }) {
  const t = useTranslations("dashboard.widgets.activity");
  const tType = useTranslations("contacts.activity.types");
  const format = useFormatSettings();
  const who = (item.actor_id && names.get(item.actor_id)) || t("someone");
  return (
    <Row
      href={`/app/kontakty/${item.contact_id}`}
      lead={formatDateTime(new Date(item.occurred_at), format)}
    >
      {t("line", {
        who,
        what: tType(item.type as "call"),
        contact: item.contactName || t("unnamed"),
      })}
    </Row>
  );
}

export const activityWidget = defineWidget<{ items: ActivityItem[]; names: Map<string, string> }>({
  key: "activity",
  useData: useActivity,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.activity");
    if (data.items.length === 0) {
      return (
        <Empty
          icon={ActivityIcon}
          title={t("emptyTitle")}
          hint={t("emptyHint")}
          compact={size === "M"}
        />
      );
    }
    return (
      <RowList>
        {data.items.slice(0, size === "XL" ? 6 : size === "L" ? 5 : 2).map((item) => (
          <ActivityRow key={item.id} item={item} names={data.names} />
        ))}
      </RowList>
    );
  },
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.activity");
    if (data.items.length === 0) {
      return <Empty icon={ActivityIcon} title={t("emptyTitle")} hint={t("emptyHint")} />;
    }
    return (
      <RowList>
        {data.items.map((item) => (
          <ActivityRow key={item.id} item={item} names={data.names} />
        ))}
      </RowList>
    );
  },
});
