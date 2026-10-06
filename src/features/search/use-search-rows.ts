"use client";

import { useMemo } from "react";
import {
  ArrowLeftRightIcon,
  CalendarDaysIcon,
  ContactRoundIcon,
  FlagIcon,
  HistoryIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ReceiptTextIcon,
  SettingsIcon,
  SquareKanbanIcon,
  UserPlusIcon,
  UsersRoundIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useNavItems } from "@/components/layout/use-nav";
import { useSession, useUserSettings } from "@/features/account/queries";
import {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatDateTime,
  todayIsoDate,
  type FormatSettings,
} from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useFormatSettings } from "@/lib/use-format-settings";
import { QUICK_ACTIONS, SETTINGS_ENTRIES } from "./catalog";
import type { SearchHistory, SearchHit } from "./queries";
import {
  DB_KINDS,
  GROUP_SIZE,
  localScore,
  orderGroups,
  parseAmount,
  tidyQuery,
  type DbKind,
  type ResultKind,
} from "./search-logic";
import { phoneSearchDigits } from "@/features/contacts/contact-search";

export type RowKind = ResultKind | "recentSearch" | "create";

export type Row = {
  key: string;
  kind: RowKind;
  id: string;
  title: string;
  context: string | null;
  /** Where Enter goes; a recent search fills the field instead. */
  href: string | null;
  fill?: string;
  icon: LucideIcon;
  rank: number;
};

export type RowGroup = {
  key: string;
  label: string;
  rows: Row[];
  /** A database kind with more rows than shown: offers "Show all". */
  showAll: DbKind | null;
};

export const KIND_ICONS: Record<RowKind, LucideIcon> = {
  contact: ContactRoundIcon,
  deal: SquareKanbanIcon,
  milestone: FlagIcon,
  task: ListChecksIcon,
  event: CalendarDaysIcon,
  transaction: ArrowLeftRightIcon,
  invoice: ReceiptTextIcon,
  worker: UsersRoundIcon,
  section: LayoutGridIcon,
  setting: SettingsIcon,
  action: ZapIcon,
  recentSearch: HistoryIcon,
  create: UserPlusIcon,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Where a database result opens. */
export function hitHref(hit: SearchHit, settings: FormatSettings): string {
  const id = encodeURIComponent(hit.id);
  switch (hit.kind) {
    case "contact":
      return `/app/kontakty/${id}`;
    case "deal":
      return `/app/pipeline?deal=${id}`;
    case "milestone":
      return `/app/milniky/${id}`;
    case "task": {
      const milestone = text(hit.data.milestoneId);
      return milestone ? `/app/milniky/${encodeURIComponent(milestone)}` : "/app/milniky";
    }
    case "event": {
      const starts = text(hit.data.startsAt);
      const date = starts ? todayIsoDate(settings, new Date(starts)) : null;
      return date ? `/app/kalendar?event=${id}&date=${date}` : `/app/kalendar?event=${id}`;
    }
    case "transaction":
      return `/app/finance?tab=transactions&transaction=${id}`;
    case "invoice":
      return "/app/finance?tab=invoices";
    case "worker":
      return `/app/pracovnici/${id}`;
  }
}

type Args = {
  query: string;
  hits: SearchHit[] | undefined;
  history: SearchHistory | undefined;
  /** "Show all" of one kind: only that group, all its rows. */
  expanded: DbKind | null;
};

/** Everything the window lists, grouped, best groups first. */
export function useSearchRows({ query, hits, history, expanded }: Args): RowGroup[] {
  const t = useTranslations("search");
  const tNav = useTranslations("nav");
  const settings = useFormatSettings();
  const { worker } = useSession();
  const userCountry = useUserSettings().country_code;
  const { items: navItems } = useNavItems();

  return useMemo(() => {
    const tidy = tidyQuery(query);
    const phoneLike = phoneSearchDigits(tidy).length > 0 && parseAmount(tidy) === null;
    const openSections = new Set(navItems.filter((item) => !item.locked).map((item) => item.key));

    const actions: Row[] = worker
      ? []
      : QUICK_ACTIONS.filter((action) => openSections.has(action.section)).map((action) => ({
          key: `action:${action.id}`,
          kind: "action",
          id: action.id,
          title: t(`actions.${action.id}`),
          context: null,
          href: action.href,
          icon: action.icon,
          rank: 0,
        }));

    // Nothing typed yet: what was opened and searched lately, then the quick actions.
    if (!tidy) {
      const groups: RowGroup[] = [];
      const recentItems = (history?.items ?? []).map<Row>((item) => ({
        key: `recent:${item.kind}:${item.id}`,
        kind: item.kind,
        id: item.id,
        title: item.title,
        context: null,
        href: item.href,
        icon: KIND_ICONS[item.kind],
        rank: 0,
      }));
      const recentSearches = (history?.searches ?? []).map<Row>((search) => ({
        key: `search:${search}`,
        kind: "recentSearch",
        id: search,
        title: search,
        context: null,
        href: null,
        fill: search,
        icon: KIND_ICONS.recentSearch,
        rank: 0,
      }));
      if (recentItems.length)
        groups.push({
          key: "recentItems",
          label: t("groups.recentItems"),
          rows: recentItems,
          showAll: null,
        });
      if (recentSearches.length)
        groups.push({
          key: "recentSearches",
          label: t("groups.recentSearches"),
          rows: recentSearches,
          showAll: null,
        });
      if (actions.length)
        groups.push({ key: "action", label: t("groups.action"), rows: actions, showAll: null });
      return groups;
    }

    function context(hit: SearchHit): string | null {
      const d = hit.data;
      const join = (...parts: (string | null | undefined)[]) =>
        parts.filter((part): part is string => !!part).join(" · ") || null;
      switch (hit.kind) {
        case "contact": {
          const company = text(d.company);
          const other = company && company !== hit.title ? company : text(d.person);
          const table = text(d.table);
          const phone = phoneLike ? text(d.phone) : null;
          return join(
            other !== hit.title ? other : null,
            phone ? formatPhone(phone, userCountry) : null,
            table ? t("context.table", { table }) : null,
          );
        }
        case "deal": {
          const value = num(d.value);
          return join(
            text(d.stage),
            value !== null ? formatCurrency(value, text(d.currency) ?? undefined, settings) : null,
            text(d.contact),
          );
        }
        case "milestone": {
          const status = text(d.status);
          const target = text(d.targetDate);
          return join(
            status && ["active", "completed", "archived"].includes(status)
              ? t(`context.milestoneStatus.${status as "active"}`)
              : null,
            target ? t("context.due", { date: formatCalendarDate(target, settings) }) : null,
          );
        }
        case "task": {
          const milestone = text(d.milestone);
          return milestone ? t("context.inMilestone", { milestone }) : null;
        }
        case "event": {
          const starts = text(d.startsAt);
          if (!starts) return null;
          const instant = new Date(starts);
          return d.allDay === true
            ? t("context.allDay", { date: formatDate(instant, settings) })
            : formatDateTime(instant, settings);
        }
        case "transaction": {
          const amount = num(d.amount);
          const on = text(d.occurredOn);
          return join(
            d.type === "income" ? t("context.income") : t("context.expense"),
            amount !== null
              ? formatCurrency(amount, text(d.currency) ?? undefined, settings)
              : null,
            on ? formatCalendarDate(on, settings) : null,
          );
        }
        case "invoice": {
          const amount = num(d.amount);
          const status = text(d.status);
          return join(
            text(d.customer),
            amount !== null
              ? formatCurrency(amount, text(d.currency) ?? undefined, settings)
              : null,
            status &&
              ["draft", "open", "sent", "overdue", "paid", "cancelled", "uncollectible"].includes(
                status,
              )
              ? t(`context.invoiceStatus.${status as "open"}`)
              : null,
          );
        }
        case "worker": {
          const status = text(d.status);
          return join(
            text(d.jobTitle),
            status && ["invited", "active", "inactive"].includes(status)
              ? t(`context.workerStatus.${status as "active"}`)
              : null,
          );
        }
      }
    }

    const dbGroups: RowGroup[] = DB_KINDS.filter((kind) => !expanded || kind === expanded).map(
      (kind) => {
        const ofKind = (hits ?? []).filter((hit) => hit.kind === kind);
        const shown = expanded ? ofKind : ofKind.slice(0, GROUP_SIZE);
        return {
          key: kind,
          label: t(`groups.${kind}`),
          showAll: !expanded && ofKind.length > GROUP_SIZE ? kind : null,
          rows: shown.map((hit) => ({
            key: `${hit.kind}:${hit.id}`,
            kind: hit.kind,
            id: hit.id,
            title: hit.title,
            context: context(hit),
            href: hitHref(hit, settings),
            icon: KIND_ICONS[hit.kind],
            rank: Number(hit.rank) || 0,
          })),
        };
      },
    );
    if (expanded) return dbGroups.filter((group) => group.rows.length > 0);

    const score = (row: Row, label: string, keywords: string) => ({
      ...row,
      rank: localScore(tidy, label, keywords),
    });
    const matchedActions = actions
      .map((row) => score(row, row.title, t(`keywords.${row.id as "newContact"}`)))
      .filter((row) => row.rank > 0);
    const sections = navItems
      .filter((item) => !item.locked)
      .map((item) =>
        score(
          {
            key: `section:${item.key}`,
            kind: "section",
            id: item.key,
            title: tNav(item.key),
            context: null,
            href: item.href,
            icon: item.icon,
            rank: 0,
          },
          tNav(item.key),
          t(`sections.${item.key}`),
        ),
      )
      .filter((row) => row.rank > 0);
    const settingsRows = SETTINGS_ENTRIES.filter(
      (entry) => !(worker && "ownerOnly" in entry && entry.ownerOnly),
    )
      .map((entry) => {
        const label = t(`settingsItems.${entry.id}.label`);
        const group = "group" in entry ? entry.group : null;
        const where =
          group === "account"
            ? t("context.account")
            : group === "contacts"
              ? tNav("contacts")
              : t("context.settings");
        return score(
          {
            key: `setting:${entry.id}`,
            kind: "setting",
            id: entry.id,
            title: label,
            context: where,
            href: entry.href,
            icon: entry.icon,
            rank: 0,
          },
          label,
          `${where} ${t(`settingsItems.${entry.id}.keywords`)}`,
        );
      })
      .filter((row) => row.rank > 0);

    const byRank = (a: Row, b: Row) => b.rank - a.rank;
    return orderGroups([
      ...dbGroups.map((group) => ({ ...group, items: group.rows })),
      {
        key: "action",
        label: t("groups.action"),
        showAll: null,
        items: matchedActions.sort(byRank).slice(0, GROUP_SIZE),
      },
      {
        key: "section",
        label: t("groups.section"),
        showAll: null,
        items: sections.sort(byRank).slice(0, GROUP_SIZE),
      },
      {
        key: "setting",
        label: t("groups.setting"),
        showAll: null,
        items: settingsRows.sort(byRank).slice(0, GROUP_SIZE),
      },
    ]).map(({ key, label, showAll, items }) => ({ key, label, showAll, rows: items }));
  }, [query, hits, history, expanded, navItems, worker, t, tNav, settings, userCountry]);
}
