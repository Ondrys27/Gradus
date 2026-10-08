"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookmarkIcon, BookmarkPlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EventName } from "@/lib/analytics/events";
import type { EventCalc } from "@/lib/analytics/metrics";
import { cn } from "@/lib/utils";
import type { ExplorerGrain, ExplorerQuery } from "../server/explorer-data";

type SavedView = { name: string; query: string };
const STORAGE_KEY = "admin.explorer.views";

function loadViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

function saveViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views.slice(0, 20)));
  } catch {
    // A private window or blocked storage: the picker still works, it just won't remember.
  }
}

/**
 * Event × calculation × property × grain, kept in the address. Saved views
 * are a name for the current combination, kept in this browser only.
 */
export function ExplorerControls({
  events,
  numericPropsByEvent,
  current,
}: {
  events: readonly EventName[];
  numericPropsByEvent: Record<string, string[]>;
  current: ExplorerQuery;
}) {
  const t = useTranslations("admin.explorer");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => setViews(loadViews()), []);

  function apply(next: Partial<ExplorerQuery>) {
    const merged = { ...current, ...next };
    const params = new URLSearchParams(searchParams);
    params.set("event", merged.event);
    params.set("calc", merged.calc);
    params.set("grain", merged.grain);
    if (merged.calc === "sum" || merged.calc === "avg") {
      const props = numericPropsByEvent[merged.event] ?? [];
      params.set("prop", merged.prop && props.includes(merged.prop) ? merged.prop : (props[0] ?? ""));
    } else {
      params.delete("prop");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function saveCurrentView() {
    const name = window.prompt(t("saveViewPrompt"));
    if (!name) return;
    const query = new URLSearchParams(searchParams).toString();
    const next = [{ name, query }, ...views.filter((view) => view.name !== name)];
    setViews(next);
    saveViews(next);
  }

  function removeView(name: string) {
    const next = views.filter((view) => view.name !== name);
    setViews(next);
    saveViews(next);
  }

  const needsProp = current.calc === "sum" || current.calc === "avg";
  const propOptions = numericPropsByEvent[current.event] ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("event")}>
          <Select value={current.event} items={events.map((e) => ({ value: e, label: e }))} onValueChange={(v) => typeof v === "string" && apply({ event: v as EventName })}>
            <SelectTrigger className="h-11 text-sm mouse:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[min(var(--available-height),360px)]">
              {events.map((event) => (
                <SelectItem key={event} value={event}>
                  {event}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("calc")}>
          <Select
            value={current.calc}
            items={(["count", "users", "sum", "avg"] as EventCalc[]).map((c) => ({ value: c, label: t(`calcValues.${c}`) }))}
            onValueChange={(v) => typeof v === "string" && apply({ calc: v as EventCalc })}
          >
            <SelectTrigger className="h-11 text-sm mouse:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["count", "users", "sum", "avg"] as EventCalc[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`calcValues.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {needsProp && (
          <Field label={t("prop")}>
            <Select
              value={current.prop ?? ""}
              items={propOptions.map((p) => ({ value: p, label: p }))}
              onValueChange={(v) => typeof v === "string" && apply({ prop: v })}
            >
              <SelectTrigger className="h-11 text-sm mouse:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {propOptions.map((prop) => (
                  <SelectItem key={prop} value={prop}>
                    {prop}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label={t("grain")}>
          <Select
            value={current.grain}
            items={(["day", "week", "month"] as ExplorerGrain[]).map((g) => ({ value: g, label: t(`grainValues.${g}`) }))}
            onValueChange={(v) => typeof v === "string" && apply({ grain: v as ExplorerGrain })}
          >
            <SelectTrigger className="h-11 text-sm mouse:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["day", "week", "month"] as ExplorerGrain[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`grainValues.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={saveCurrentView}>
          <BookmarkPlusIcon aria-hidden />
          {t("saveView")}
        </Button>
        {views.map((view) => (
          <span
            key={view.name}
            className={cn(
              "flex items-center gap-1 rounded-full border border-line py-1 pr-1 pl-3 text-xs text-ink-soft",
            )}
          >
            <button
              type="button"
              onClick={() => router.replace(`${pathname}?${view.query}`, { scroll: false })}
              className="flex items-center gap-1 outline-none hover:text-ink"
            >
              <BookmarkIcon aria-hidden className="size-3.5" />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => removeView(view.name)}
              aria-label={t("removeView", { name: view.name })}
              className="grid size-6 place-items-center rounded-full text-ink-muted outline-none hover:text-ink"
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="micro-label">{label}</span>
      {children}
    </div>
  );
}
