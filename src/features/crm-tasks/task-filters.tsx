"use client";

import { useEffect, useRef, useState } from "react";
import { FilterIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/features/account/queries";
import { contactName } from "@/features/contacts/types";
import { formatCalendarDate, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  applyQuickView,
  DEFAULT_FILTERS,
  DUE_FILTERS,
  DURATION_FILTERS,
  QUICK_VIEWS,
  quickViewOf,
  STATUS_FILTERS,
  type TaskFilters,
} from "./logic";
import { useAssignees, useTargetName } from "./queries";
import { TargetSearch } from "./target-picker";
import { useAssigneeName } from "./use-assignee-name";

const ANY = "__any";

type FilterKey = "due" | "who" | "status" | "duration" | "deal" | "contact";

/** A filter as it is set now, without the others. */
function cleared(filters: TaskFilters, key: FilterKey): TaskFilters {
  switch (key) {
    case "due":
      return { ...filters, due: null, from: null, to: null };
    case "who":
      return { ...filters, who: DEFAULT_FILTERS.who };
    case "status":
      return { ...filters, status: DEFAULT_FILTERS.status };
    case "duration":
      return { ...filters, duration: null };
    case "deal":
      return { ...filters, deal: null };
    case "contact":
      return { ...filters, contact: null };
  }
}

function activeKeys(filters: TaskFilters): FilterKey[] {
  const keys: FilterKey[] = [];
  if (filters.due) keys.push("due");
  if (filters.who !== DEFAULT_FILTERS.who) keys.push("who");
  if (filters.status !== DEFAULT_FILTERS.status) keys.push("status");
  if (filters.duration) keys.push("duration");
  if (filters.deal) keys.push("deal");
  if (filters.contact) keys.push("contact");
  return keys;
}

const segmentedItem =
  "h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8";

/**
 * The quick switches (Vše · Otevřené · Po termínu · Dnes), the filters panel
 * and the chips of what is filtered, like in the administration. Everything
 * is in the address, so a view can be shared and survives a reload.
 */
export function TaskFilterBar({
  filters,
  onChange,
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
}) {
  const t = useTranslations("crmTasks.filters");
  const tQuick = useTranslations("crmTasks.quick");
  const settings = useFormatSettings();
  const { user } = useSession();
  const assignees = useAssignees();
  const nameOf = useAssigneeName();
  const dealName = useTargetName("deal", filters.deal);
  const contactNameQuery = useTargetName("contact", filters.contact);
  const [panel, setPanel] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const quick = quickViewOf(filters);
  const active = activeKeys(filters);
  const today = todayIsoDate(settings);

  // Esc closes the panel and gives focus back to its button.
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanel(false);
      button.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const dueItems = [
    { value: ANY, label: t("anyDue") },
    ...DUE_FILTERS.map((value) => ({ value, label: t(`dueValues.${value}`) })),
  ];
  const whoItems = [
    { value: "anyone", label: t("anyone") },
    { value: "me", label: t("me") },
    ...(assignees.data ?? [])
      .filter((person) => person.userId !== user.id)
      .map((person) => ({ value: person.userId, label: nameOf(person.userId) })),
  ];
  const statusItems = STATUS_FILTERS.map((value) => ({ value, label: t(`statusValues.${value}`) }));
  const durationItems = [
    { value: ANY, label: t("anyDuration") },
    ...DURATION_FILTERS.map((value) => ({ value, label: t(`durationValues.${value}`) })),
  ];

  function chip(key: FilterKey): { name: string; value: string } {
    switch (key) {
      case "due": {
        if (filters.due !== "custom")
          return { name: t("due"), value: t(`dueValues.${filters.due}`) };
        const from = filters.from ? formatCalendarDate(filters.from, settings) : "…";
        const to = filters.to ? formatCalendarDate(filters.to, settings) : "…";
        return { name: t("due"), value: from === to ? from : `${from} – ${to}` };
      }
      case "who":
        return {
          name: t("who"),
          value: filters.who === "me" ? t("me") : nameOf(filters.who),
        };
      case "status":
        return { name: t("status"), value: t(`statusValues.${filters.status}`) };
      case "duration":
        return { name: t("duration"), value: t(`durationValues.${filters.duration}`) };
      case "deal":
        return {
          name: t("deal"),
          value: dealName.data?.kind === "deal" ? dealName.data.title : "…",
        };
      case "contact":
        return {
          name: t("contact"),
          value:
            contactNameQuery.data?.kind === "contact"
              ? contactName(contactNameQuery.data.contact)
              : "…",
        };
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="radiogroup"
          aria-label={tQuick("label")}
          className="flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-0.5 [scrollbar-width:none]"
        >
          {QUICK_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={quick === view}
              onClick={() => onChange(applyQuickView(filters, view))}
              className={cn(
                segmentedItem,
                quick === view ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {tQuick(view)}
            </button>
          ))}
        </div>
        <Button
          ref={button}
          type="button"
          variant={panel || active.length ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={panel}
          aria-controls="crm-task-filters"
          onClick={() => setPanel((value) => !value)}
        >
          <FilterIcon aria-hidden />
          {active.length ? t("buttonActive", { count: active.length }) : t("button")}
        </Button>
      </div>

      {panel && (
        <div
          id="crm-task-filters"
          className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <FilterSelect
            id="crm-filter-due"
            label={t("due")}
            value={filters.due ?? ANY}
            items={dueItems}
            onChange={(value) => {
              if (value === ANY) onChange(cleared(filters, "due"));
              else if (value === "custom")
                onChange({
                  ...filters,
                  due: "custom",
                  from: filters.from ?? today,
                  to: filters.to ?? today,
                });
              else onChange({ ...filters, due: value as TaskFilters["due"], from: null, to: null });
            }}
          />
          <FilterSelect
            id="crm-filter-who"
            label={t("who")}
            value={filters.who}
            items={whoItems}
            onChange={(value) => onChange({ ...filters, who: value })}
          />
          <FilterSelect
            id="crm-filter-status"
            label={t("status")}
            value={filters.status}
            items={statusItems}
            onChange={(value) => onChange({ ...filters, status: value as TaskFilters["status"] })}
          />
          <FilterSelect
            id="crm-filter-duration"
            label={t("duration")}
            value={filters.duration ?? ANY}
            items={durationItems}
            onChange={(value) =>
              onChange({
                ...filters,
                duration: value === ANY ? null : (value as TaskFilters["duration"]),
              })
            }
          />
          {filters.due === "custom" && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-ink-muted">{t("range")}</span>
              <div className="flex items-center gap-1.5">
                <DatePicker
                  value={filters.from}
                  className="min-w-0 flex-1"
                  onValueChange={(from) =>
                    from &&
                    onChange({
                      ...filters,
                      from,
                      to: filters.to && filters.to >= from ? filters.to : from,
                    })
                  }
                />
                <span aria-hidden className="text-ink-muted">
                  –
                </span>
                <DatePicker
                  value={filters.to}
                  className="min-w-0 flex-1"
                  onValueChange={(to) =>
                    to &&
                    onChange({
                      ...filters,
                      to,
                      from: filters.from && filters.from <= to ? filters.from : to,
                    })
                  }
                />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="crm-filter-target" className="text-xs font-medium text-ink-muted">
              {t("target")}
            </label>
            <TargetSearch
              id="crm-filter-target"
              placeholder={t("targetPlaceholder")}
              onPick={(option) =>
                onChange(
                  option.kind === "deal"
                    ? { ...filters, deal: option.id, contact: null }
                    : { ...filters, contact: option.id, deal: null },
                )
              }
            />
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap gap-1.5" aria-label={t("activeLabel")}>
            {active.map((key) => {
              const { name, value } = chip(key);
              const text = `${name}: ${value}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onChange(cleared(filters, key))}
                    aria-label={t("remove", { filter: text })}
                    className="flex h-10 max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-violet/40 bg-violet/12 px-2.5 text-xs text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
                  >
                    <span className="text-ink-soft">{name}:</span>
                    <span className="truncate">{value}</span>
                    <XIcon aria-hidden className="size-3 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTERS)}>
            {t("clear")}
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-muted">
        {label}
      </label>
      <Select
        value={value}
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger id={id} className="h-11 text-sm mouse:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[min(var(--available-height),360px)]">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
