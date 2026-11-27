"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useIsPlaying } from "@/features/game/queries";
import { industryKeyOf } from "@/features/onboarding/industries";
import { track } from "@/lib/analytics/client";
import { formatList, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { daySummaryParts, greetingPart } from "./dashboard-logic";
import { SatisfactionCard } from "./satisfaction-card";
import { useTodayOverview } from "./today-card";
import { systemDefault } from "./widgets/defaults";
import { MAX_LAYOUTS, type LayoutItem } from "@/features/widgets/grid";
import {
  useCreateLayout,
  useDashboardContext,
  useDashboardLayouts,
  useDeleteLayout,
  useKeepOwnLayout,
  useRenameLayout,
  useResetMainLayout,
  useSaveLayoutItems,
  type StoredLayout,
} from "./widgets/layout-queries";
import { resolveMain } from "./widgets/resolve";
import { useBoardEditor } from "@/features/widgets/use-board-editor";
import { useAppWidgetSystem } from "./widgets/app-system";
import { useWidgetAccess } from "./widgets/use-widget-access";
import { WidgetBoard } from "@/features/widgets/widget-board";

const MAIN = "main";

/**
 * The dashboard (/app, 28.5): a greeting with the day in one sentence, then
 * the person's dashboards of widgets as tabs. The first one follows the
 * default (the company's for a worker, the system's by mode and industry)
 * until the person changes it; up to five more are their own.
 */
export function DashboardHome() {
  const t = useTranslations("dashboard");
  const tBoard = useTranslations("dashboard.board");
  const locale = useLocale();
  const settings = useFormatSettings();
  const profile = useProfile();
  const workspace = useWorkspace();
  const playing = useIsPlaying();
  const overview = useTodayOverview();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const layouts = useDashboardLayouts();
  const context = useDashboardContext();
  const saveItems = useSaveLayoutItems();
  const resetMain = useResetMainLayout();
  const keepOwn = useKeepOwnLayout();
  const createLayout = useCreateLayout();
  const renameLayout = useRenameLayout();
  const deleteLayout = useDeleteLayout();

  // A failed read of the context (or no company default) means: the system's default, all widgets.
  const company = context.data?.source ? context.data : null;
  const access = useWidgetAccess(context.data?.allowed ?? null);
  const widgetSystem = useAppWidgetSystem(access);
  const rows = useMemo(
    () => layouts.data ?? (layouts.isError ? [] : undefined),
    [layouts.data, layouts.isError],
  );
  const mainRow = rows?.find((row) => row.isDefault) ?? null;
  const tabs = useMemo(() => (rows ?? []).filter((row) => !row.isDefault), [rows]);

  const system = useMemo(
    () =>
      systemDefault({ role: workspace.role, playing, industry: industryKeyOf(profile.industry) }),
    [workspace.role, playing, profile.industry],
  );
  const contextReady = context.data !== undefined || context.isError;
  const resolution = useMemo(
    () =>
      rows && contextReady
        ? resolveMain({
            own: mainRow ? { items: mainRow.items, basedOn: mainRow.basedOn } : null,
            company: company ? { items: company.items, updatedAt: company.updatedAt } : null,
            system,
          })
        : undefined,
    [rows, contextReady, mainRow, company, system],
  );
  const defaultItems = company?.items ?? system;

  // The open tab lives in the address (`?board=<id>`), the main one without it.
  const requested = searchParams.get("board");
  const active: StoredLayout | null = tabs.find((tab) => tab.id === requested) ?? null;
  const boardKey = active ? active.id : MAIN;
  function selectTab(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (id === MAIN) next.delete("board");
    else next.set("board", id);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Saves go one after another, so the first change of the main tab makes exactly one row.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const mainId = useRef<string | null>(null);
  useEffect(() => {
    mainId.current = mainRow?.id ?? null;
  }, [mainRow?.id]);
  const companyVersion = company?.updatedAt ?? null;
  const save = useCallback(
    (items: LayoutItem[]) => {
      const run = async () => {
        if (boardKey === MAIN) {
          const saved = await saveItems.mutateAsync({
            kind: "main",
            layoutId: mainId.current,
            items,
            basedOn: companyVersion,
          });
          mainId.current = saved.id;
        } else {
          await saveItems.mutateAsync({ kind: "tab", layoutId: boardKey, items });
        }
      };
      chain.current = chain.current.catch(() => undefined).then(run);
      return chain.current;
    },
    // mutateAsync is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardKey, companyVersion],
  );

  const source = boardKey === MAIN ? resolution?.items : (active?.items ?? undefined);
  const editor = useBoardEditor({ source, save, boardKey });

  const [naming, setNaming] = useState<{ mode: "new" | "rename"; value: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const name = (profile.display_name || profile.username || "").trim();
  const greeting = t(`greeting.${greetingPart(new Date(), settings.timeZone)}`, {
    hasName: name ? "yes" : "no",
    name,
  });
  const parts = daySummaryParts(overview.counts);
  const summary =
    parts.length === 0
      ? t("summary.empty")
      : t("summary.lead", {
          list: formatList(
            parts.map(({ part, count }) =>
              t(`summary.${part}`, { count, formatted: formatNumber(count, {}, settings) }),
            ),
            locale,
          ),
        });

  const openWidgetKey = searchParams.get("widget");
  const clearWidgetParam = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    if (!next.has("widget")) return;
    next.delete("widget");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const fromCompany = boardKey === MAIN && resolution?.defaultFrom === "company";
  const resetLabel = fromCompany ? tBoard("resetCompany") : tBoard("reset");
  function reset() {
    if (boardKey === MAIN) {
      if (mainRow) resetMain.mutate(mainRow.id);
      // Nothing of the person's own: the board already follows the default.
    } else {
      editor.apply(defaultItems);
    }
    track("dashboard_layout_reset", { to: company ? "company" : "system" });
  }

  const banner =
    boardKey === MAIN && resolution?.offer && mainRow && company?.updatedAt ? (
      <div
        className="flex flex-wrap items-center gap-3 rounded-card border border-teal/40 bg-teal/8 px-4 py-3 text-sm text-ink"
        data-testid="company-dashboard-offer"
      >
        <span className="mr-auto">{tBoard("offer")}</span>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            resetMain.mutate(mainRow.id);
            track("dashboard_default_offer", { action: "adopted" });
          }}
        >
          {tBoard("offerAdopt")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            keepOwn.mutate({ layoutId: mainRow.id, basedOn: company.updatedAt! });
            track("dashboard_default_offer", { action: "kept" });
          }}
        >
          {tBoard("offerKeep")}
        </Button>
      </div>
    ) : null;

  const placesSurvey = (editor.items ?? []).some((item) => item.widget === "satisfaction");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2" data-tutorial="dashboard-summary">
        <h1 className="page-title text-balance">{greeting}</h1>
        <div className="min-h-6 max-w-2xl text-base text-ink-soft" aria-live="polite">
          {overview.pending ? <Skeleton className="h-6 w-72 max-w-full" /> : summary}
        </div>
      </header>

      {/* The survey is not lost when its widget is not on the board. */}
      {!placesSurvey && editor.items && <SatisfactionCard />}

      <WidgetBoard
        editor={editor}
        system={widgetSystem}
        scope={boardKey}
        banner={banner}
        leading={
          rows && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label={tBoard("tabs")}
                className="flex max-w-full gap-1 overflow-x-auto"
                data-testid="board-tabs"
                data-tutorial="dashboard-tabs"
              >
                {[
                  { id: MAIN, label: tBoard("mainTab") },
                  ...tabs.map((tab) => ({ id: tab.id, label: tab.name ?? "" })),
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={boardKey === tab.id}
                    onClick={() => selectTab(tab.id)}
                    data-testid="board-tab"
                    className={cn(
                      "min-h-10 shrink-0 rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                      boardKey === tab.id
                        ? "bg-violet/20 text-ink"
                        : "text-ink-soft hover:bg-surface-hover hover:text-ink",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {tabs.length < MAX_LAYOUTS - 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tBoard("newTab")}
                  title={tBoard("newTab")}
                  onClick={() => setNaming({ mode: "new", value: "" })}
                  data-testid="board-new-tab"
                  data-tutorial="dashboard-new-tab"
                >
                  <PlusIcon aria-hidden />
                </Button>
              )}
              {active && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tBoard("renameTab")}
                    title={tBoard("renameTab")}
                    onClick={() => setNaming({ mode: "rename", value: active.name ?? "" })}
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tBoard("deleteTab")}
                    title={tBoard("deleteTab")}
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2Icon aria-hidden className="text-destructive" />
                  </Button>
                </>
              )}
            </div>
          )
        }
        onReset={boardKey !== MAIN || mainRow?.items ? reset : undefined}
        resetLabel={resetLabel}
        openWidgetKey={openWidgetKey}
        onOpenWidgetKeyHandled={clearWidgetParam}
      />

      <ResponsiveDialog
        open={naming !== null}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
        title={naming?.mode === "rename" ? tBoard("renameTab") : tBoard("newTab")}
        closeLabel={tBoard("close")}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = naming?.value.trim() ?? "";
            if (!value || value.length > 40) return;
            if (naming?.mode === "rename" && active) {
              renameLayout.mutate({ layoutId: active.id, name: value });
              track("dashboard_layout_renamed", {});
            } else {
              createLayout.mutate(
                { name: value, items: [], taken: tabs.map((tab) => tab.position) },
                {
                  onSuccess: (created) => {
                    track("dashboard_layout_created", { count: tabs.length + 2 });
                    selectTab(created.id);
                  },
                },
              );
            }
            setNaming(null);
          }}
        >
          <Input
            autoFocus
            maxLength={40}
            value={naming?.value ?? ""}
            onChange={(event) =>
              setNaming((previous) => previous && { ...previous, value: event.target.value })
            }
            placeholder={tBoard("tabPlaceholder")}
            aria-label={tBoard("tabName")}
            data-testid="board-tab-name"
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setNaming(null)}>
              {tBoard("cancel")}
            </Button>
            <Button type="submit" disabled={!naming?.value.trim()} data-testid="board-tab-save">
              {tBoard("save")}
            </Button>
          </div>
        </form>
      </ResponsiveDialog>

      {active && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={tBoard("deleteTab")}
          description={tBoard("deleteTabConfirm", { name: active.name ?? "" })}
          confirmLabel={tBoard("deleteTab")}
          cancelLabel={tBoard("cancel")}
          closeLabel={tBoard("close")}
          onConfirm={() => {
            deleteLayout.mutate(active.id);
            track("dashboard_layout_deleted", { count: tabs.length });
            setDeleting(false);
            selectTab(MAIN);
          }}
        />
      )}
    </div>
  );
}
