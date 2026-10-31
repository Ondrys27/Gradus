"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FilterIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/features/account/queries";
import { contactName } from "@/features/contacts/types";
import { useAssignees, useTargetName } from "@/features/crm-tasks/queries";
import { useAssigneeName } from "@/features/crm-tasks/use-assignee-name";
import { formatCalendarDate, formatNumber, todayIsoDate, type IsoDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { contactLabel } from "./board-logic";
import {
  activeDealFilters,
  clearDealFilter,
  CLOSE_FILTERS,
  IDLE_FILTERS,
  NO_DEAL_FILTERS,
  TASK_FILTERS,
  type DealFilterKey,
  type DealFilters,
} from "./filters";
import { useContactSearch } from "./queries";

const ANY = "__any";
const PANEL_ID = "pipeline-filters";

type Props = {
  filters: DealFilters;
  onChange: (next: DealFilters, changed: DealFilterKey | null) => void;
  /** Deals shown with the filters on, and on the board in all. */
  shown: number;
  total: number;
};

/**
 * The filters above the pipeline as a panel and chips of what is set, like
 * the Tasks section. Everything is in the address, so a view can be shared.
 */
export function DealFilterBar({ filters, onChange, shown, total }: Props) {
  const t = useTranslations("pipeline.filters");
  const settings = useFormatSettings();
  const { user } = useSession();
  const assignees = useAssignees();
  const nameOf = useAssigneeName();
  const contact = useTargetName("contact", filters.contact);
  const [panel, setPanel] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const active = activeDealFilters(filters);
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

  const set = (next: Partial<DealFilters>, key: DealFilterKey) =>
    onChange({ ...filters, ...next }, key);
  const date = (value: IsoDate) => formatCalendarDate(value, settings);
  const range = (from: IsoDate | null, to: IsoDate | null) => {
    if (from && to) return from === to ? date(from) : `${date(from)} – ${date(to)}`;
    if (from) return t("rangeFrom", { date: date(from) });
    return to ? t("rangeTo", { date: date(to) }) : "";
  };
  const amount = (value: number) => formatNumber(value, {}, settings);

  function chip(key: DealFilterKey): { name: string; value: string } {
    switch (key) {
      case "close":
        return {
          name: t("close"),
          value:
            filters.close === "custom"
              ? range(filters.closeFrom, filters.closeTo)
              : t(`closeValues.${filters.close!}`),
        };
      case "created":
        return { name: t("created"), value: range(filters.createdFrom, filters.createdTo) };
      case "idle":
        return {
          name: t("idle"),
          value:
            filters.idle === "custom"
              ? range(filters.idleFrom, filters.idleTo)
              : t(`idleValues.${filters.idle!}`),
        };
      case "tasks":
        return { name: t("tasks"), value: t(`taskValues.${filters.tasks!}`) };
      case "who":
        return { name: t("who"), value: filters.who === "me" ? t("me") : nameOf(filters.who!) };
      case "contact":
        return {
          name: t("contact"),
          value: contact.data?.kind === "contact" ? contactName(contact.data.contact) : "…",
        };
      case "amount": {
        const { min, max } = filters;
        const value =
          min !== null && max !== null
            ? `${amount(min)} – ${amount(max)}`
            : min !== null
              ? t("rangeFrom", { date: amount(min) })
              : t("rangeTo", { date: amount(max!) });
        return { name: t("amount"), value };
      }
    }
  }

  const closeItems = [
    { value: ANY, label: t("anyClose") },
    ...CLOSE_FILTERS.map((value) => ({ value, label: t(`closeValues.${value}`) })),
  ];
  const idleItems = [
    { value: ANY, label: t("anyIdle") },
    ...IDLE_FILTERS.map((value) => ({ value, label: t(`idleValues.${value}`) })),
  ];
  const taskItems = [
    { value: ANY, label: t("anyTasks") },
    ...TASK_FILTERS.map((value) => ({ value, label: t(`taskValues.${value}`) })),
  ];
  const whoItems = [
    { value: ANY, label: t("anyone") },
    { value: "me", label: t("me") },
    ...(assignees.data ?? [])
      .filter((person) => person.userId !== user.id)
      .map((person) => ({ value: person.userId, label: nameOf(person.userId) })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          ref={button}
          type="button"
          variant={panel || active.length ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={panel}
          aria-controls={PANEL_ID}
          onClick={() => setPanel((value) => !value)}
        >
          <FilterIcon aria-hidden />
          {active.length ? t("buttonActive", { count: active.length }) : t("button")}
        </Button>
        {active.length > 0 && (
          <span className="text-sm text-ink-soft" aria-live="polite">
            {t("shown", {
              shown: formatNumber(shown, {}, settings),
              total,
              totalFormatted: formatNumber(total, {}, settings),
            })}
          </span>
        )}
      </div>

      {panel && (
        <div
          id={PANEL_ID}
          className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <FilterSelect
            id="deal-filter-close"
            label={t("close")}
            value={filters.close ?? ANY}
            items={closeItems}
            onChange={(value) =>
              value === ANY
                ? onChange(clearDealFilter(filters, "close"), null)
                : value === "custom"
                  ? set(
                      {
                        close: "custom",
                        closeFrom: filters.closeFrom ?? today,
                        closeTo: filters.closeTo ?? today,
                      },
                      "close",
                    )
                  : set(
                      { close: value as DealFilters["close"], closeFrom: null, closeTo: null },
                      "close",
                    )
            }
          />
          <FilterSelect
            id="deal-filter-idle"
            label={t("idle")}
            value={filters.idle ?? ANY}
            items={idleItems}
            onChange={(value) =>
              value === ANY
                ? onChange(clearDealFilter(filters, "idle"), null)
                : value === "custom"
                  ? set(
                      {
                        idle: "custom",
                        idleFrom: filters.idleFrom ?? today,
                        idleTo: filters.idleTo ?? today,
                      },
                      "idle",
                    )
                  : set(
                      { idle: value as DealFilters["idle"], idleFrom: null, idleTo: null },
                      "idle",
                    )
            }
          />
          <FilterSelect
            id="deal-filter-tasks"
            label={t("tasks")}
            value={filters.tasks ?? ANY}
            items={taskItems}
            onChange={(value) =>
              value === ANY
                ? onChange(clearDealFilter(filters, "tasks"), null)
                : set({ tasks: value as DealFilters["tasks"] }, "tasks")
            }
          />
          <FilterSelect
            id="deal-filter-who"
            label={t("who")}
            value={filters.who ?? ANY}
            items={whoItems}
            onChange={(value) =>
              value === ANY
                ? onChange(clearDealFilter(filters, "who"), null)
                : set({ who: value }, "who")
            }
          />
          {filters.close === "custom" && (
            <DateRange
              label={`${t("close")} · ${t("range")}`}
              from={filters.closeFrom}
              to={filters.closeTo}
              onChange={(closeFrom, closeTo) =>
                closeFrom || closeTo
                  ? set({ closeFrom, closeTo }, "close")
                  : onChange(clearDealFilter(filters, "close"), null)
              }
            />
          )}
          {filters.idle === "custom" && (
            <DateRange
              label={`${t("idle")} · ${t("range")}`}
              from={filters.idleFrom}
              to={filters.idleTo}
              onChange={(idleFrom, idleTo) =>
                idleFrom || idleTo
                  ? set({ idleFrom, idleTo }, "idle")
                  : onChange(clearDealFilter(filters, "idle"), null)
              }
            />
          )}
          <DateRange
            label={t("created")}
            from={filters.createdFrom}
            to={filters.createdTo}
            optional
            onChange={(createdFrom, createdTo) =>
              onChange(
                { ...filters, createdFrom, createdTo },
                createdFrom || createdTo ? "created" : null,
              )
            }
          />
          <AmountRange
            min={filters.min}
            max={filters.max}
            onChange={(min, max) =>
              onChange({ ...filters, min, max }, min !== null || max !== null ? "amount" : null)
            }
          />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="deal-filter-contact" className="text-xs font-medium text-ink-muted">
              {t("contact")}
            </label>
            <ContactFilterSearch onPick={(id) => set({ contact: id }, "contact")} />
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
                    onClick={() => onChange(clearDealFilter(filters, key), null)}
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(NO_DEAL_FILTERS, null)}
          >
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

/** Two days, either may be empty when `optional`; the ends always stay in order. */
function DateRange({
  label,
  from,
  to,
  optional = false,
  onChange,
}: {
  label: string;
  from: IsoDate | null;
  to: IsoDate | null;
  optional?: boolean;
  onChange: (from: IsoDate | null, to: IsoDate | null) => void;
}) {
  const t = useTranslations("pipeline.filters");
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <DatePicker
          value={from}
          placeholder={t("from")}
          className="min-w-0 flex-1"
          onValueChange={(next) => {
            if (!next && !optional) return;
            onChange(next, next && to && to < next ? next : to);
          }}
        />
        <span aria-hidden className="text-ink-muted">
          –
        </span>
        <DatePicker
          value={to}
          placeholder={t("to")}
          className="min-w-0 flex-1"
          onValueChange={(next) => {
            if (!next && !optional) return;
            onChange(next && from && from > next ? next : from, next);
          }}
        />
      </div>
    </div>
  );
}

/** Amount from–to; saved when the field is left or Enter is pressed. */
function AmountRange({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const t = useTranslations("pipeline.filters");
  const [from, setFrom] = useState(min === null ? "" : String(min));
  const [to, setTo] = useState(max === null ? "" : String(max));
  // A chip taken off clears the fields too.
  useEffect(() => setFrom(min === null ? "" : String(min)), [min]);
  useEffect(() => setTo(max === null ? "" : String(max)), [max]);

  const read = (text: string) => {
    const clean = text.replace(/\s/g, "").replace(",", ".");
    if (!clean) return null;
    const value = Number(clean);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const commit = () => {
    let low = read(from);
    let high = read(to);
    if (low !== null && high !== null && low > high) [low, high] = [high, low];
    if (low !== min || high !== max) onChange(low, high);
  };
  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };

  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs font-medium text-ink-muted">{t("amount")}</span>
      <div className="flex items-center gap-1.5">
        <Input
          id="deal-filter-min"
          value={from}
          inputMode="decimal"
          aria-label={`${t("amount")} ${t("from")}`}
          placeholder={t("from")}
          className="h-11 min-w-0 flex-1 text-sm mouse:h-9"
          onChange={(event) => setFrom(event.target.value)}
          onBlur={commit}
          onKeyDown={keys}
        />
        <span aria-hidden className="text-ink-muted">
          –
        </span>
        <Input
          id="deal-filter-max"
          value={to}
          inputMode="decimal"
          aria-label={`${t("amount")} ${t("to")}`}
          placeholder={t("to")}
          className="h-11 min-w-0 flex-1 text-sm mouse:h-9"
          onChange={(event) => setTo(event.target.value)}
          onBlur={commit}
          onKeyDown={keys}
        />
      </div>
    </div>
  );
}

/** Finds an existing contact as you type; never creates one. */
function ContactFilterSearch({ onPick }: { onPick: (id: string) => void }) {
  const t = useTranslations("pipeline.filters");
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term.trim(), 250);
  const search = useContactSearch(debounced);
  const name = term.trim();
  const results = name && debounced === name ? (search.data ?? []) : [];
  const settled = name !== "" && debounced === name && !search.isFetching;

  return (
    <div className="flex flex-col gap-2">
      <Input
        id="deal-filter-contact"
        value={term}
        autoComplete="off"
        placeholder={t("contactPlaceholder")}
        className="h-11 text-sm mouse:h-9"
        onChange={(event) => setTerm(event.target.value)}
      />
      {name && (results.length > 0 || settled) && (
        <ul
          aria-label={t("contactResults")}
          className="flex flex-col overflow-hidden rounded-xl border border-line"
        >
          {results.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(contact.id);
                  setTerm("");
                }}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 text-left text-sm text-ink-soft outline-none hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover mouse:min-h-9"
              >
                <Avatar name={contactLabel(contact)} className="size-6 text-[10px]" />
                <span className="truncate">{contactLabel(contact)}</span>
              </button>
            </li>
          ))}
          {settled && results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-ink-muted">{t("contactNone")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
