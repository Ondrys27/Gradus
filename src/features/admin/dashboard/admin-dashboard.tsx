"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PencilIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { MAX_LAYOUTS, type LayoutItem } from "@/features/widgets/grid";
import { useBoardEditor } from "@/features/widgets/use-board-editor";
import { WidgetBoard } from "@/features/widgets/widget-board";
import { cn } from "@/lib/utils";
import { adminCan, type AdminActor } from "../roles";
import { AdminActorProvider } from "./actor";
import { useAdminWidgetSystem } from "./admin-system";
import { ADMIN_TEMPLATES, adminTemplate, type AdminTemplate } from "./defaults";
import {
  createAdminLayout,
  deleteAdminLayout,
  renameAdminLayout,
  resetAdminMainLayout,
  saveAdminLayout,
  setAdminDashboardDefault,
} from "./server/layout-actions";
import type { AdminDashboardState, AdminStoredLayout } from "./server/layouts";

const MAIN = "main";

type Naming = { mode: "new" | "rename"; value: string; template: AdminTemplate | "empty" };

/**
 * The administration's overview (/admin, 29.2): the administrator's own
 * boards of widgets as tabs, with the same board as the app's dashboard
 * (editing, gallery, sizes, settings, detail, ⌘Z, saving by itself). The
 * main tab follows the default for administrators (the owner's, or the
 * system's) until it is changed; up to five more are the administrator's,
 * empty or one of the ready sets (Operations, Money, AI, People).
 */
export function AdminDashboard({
  actor,
  initial,
}: {
  actor: AdminActor;
  initial: AdminDashboardState;
}) {
  const t = useTranslations("admin.widgets.board");
  const tBoard = useTranslations("dashboard.board");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const system = useAdminWidgetSystem(actor);

  const [layouts, setLayouts] = useState<AdminStoredLayout[]>(initial.layouts);
  const [failed, setFailed] = useState<string | null>(null);
  const mainRow = layouts.find((layout) => layout.isDefault) ?? null;
  const tabs = useMemo(() => layouts.filter((layout) => !layout.isDefault), [layouts]);
  const templates = ADMIN_TEMPLATES.filter(
    (template) => template !== "money" || adminCan(actor, "viewMoney"),
  );

  const requested = searchParams.get("board");
  const active = tabs.find((tab) => tab.id === requested) ?? null;
  const boardKey = active ? active.id : MAIN;

  // The tab and the opened widget live in the address, written straight into
  // the history (Next.js keeps useSearchParams in step): a router navigation
  // would render the page on the server again and write one more audit row
  // for every switch of a tab, not one per opening of the overview. The state
  // must be null: Next.js only syncs useSearchParams for entries without its
  // own `__NA` marker, so passing window.history.state would leave the tab as it was.
  const replaceQuery = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

  const selectTab = useCallback(
    (id: string) => {
      const next = new URLSearchParams(window.location.search);
      if (id === MAIN) next.delete("board");
      else next.set("board", id);
      replaceQuery(next);
    },
    [replaceQuery],
  );

  // Saves go one after another, so the first change of the main tab makes exactly one row.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const mainId = useRef<string | null>(mainRow?.id ?? null);
  useEffect(() => {
    mainId.current = mainRow?.id ?? null;
  }, [mainRow?.id]);

  const save = useCallback(
    (items: LayoutItem[]) => {
      const key = boardKey;
      const run = async () => {
        const result = await saveAdminLayout({
          layoutId: key === MAIN ? mainId.current : key,
          items,
        });
        if (!result.ok) throw new Error(result.error);
        if (key === MAIN) mainId.current = result.value.id;
        setLayouts((list) =>
          list.some((layout) => layout.id === result.value.id)
            ? list.map((layout) => (layout.id === result.value.id ? result.value : layout))
            : [result.value, ...list],
        );
      };
      chain.current = chain.current.catch(() => undefined).then(run);
      return chain.current;
    },
    [boardKey],
  );

  const source = boardKey === MAIN ? (mainRow?.items ?? initial.defaultItems) : (active?.items ?? undefined);
  const editor = useBoardEditor({ source, save, boardKey });

  const [naming, setNaming] = useState<Naming | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [defaultSaved, setDefaultSaved] = useState(false);

  const openWidgetKey = searchParams.get("widget");
  const clearWidgetParam = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    if (!next.has("widget")) return;
    next.delete("widget");
    replaceQuery(next);
  }, [replaceQuery]);

  async function reset() {
    if (boardKey === MAIN) {
      if (!mainRow?.items) return;
      const result = await resetAdminMainLayout();
      if (!result.ok) {
        setFailed(t("failed"));
        return;
      }
      setLayouts((list) => list.map((layout) => (layout.isDefault ? { ...layout, items: null } : layout)));
    } else {
      editor.apply(initial.defaultItems);
    }
  }

  async function submitName(value: string) {
    if (!naming) return;
    if (naming.mode === "rename" && active) {
      const result = await renameAdminLayout({ layoutId: active.id, name: value });
      if (!result.ok) return setFailed(t("failed"));
      setLayouts((list) => list.map((layout) => (layout.id === active.id ? { ...layout, name: value } : layout)));
      return;
    }
    const items = naming.template === "empty" ? [] : adminTemplate(naming.template);
    const result = await createAdminLayout({ name: value, items });
    if (!result.ok) return setFailed(result.error === "limit" ? t("limit") : t("failed"));
    setLayouts((list) => [...list, result.value]);
    selectTab(result.value.id);
  }

  const canSetDefault = adminCan(actor, "setDashboardDefault");
  const mainLabel = t("mainTab");

  return (
    <AdminActorProvider actor={actor}>
      <div className="flex flex-col gap-4" data-testid="admin-dashboard">
        {failed && (
          <FormAlert>
            <span className="flex flex-wrap items-center gap-2">
              {failed}
              <Button type="button" variant="outline" size="sm" onClick={() => setFailed(null)}>
                {tBoard("close")}
              </Button>
            </span>
          </FormAlert>
        )}
        {defaultSaved && <FormAlert tone="success">{t("defaultSaved")}</FormAlert>}
        <WidgetBoard
          editor={editor}
          system={system}
          scope={`admin-${boardKey}`}
          leading={
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label={tBoard("tabs")}
                className="flex max-w-full gap-1 overflow-x-auto"
                data-testid="board-tabs"
                data-tutorial="admin-board-tabs"
              >
                {[{ id: MAIN, label: mainLabel }, ...tabs.map((tab) => ({ id: tab.id, label: tab.name ?? "" }))].map(
                  (tab) => (
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
                  ),
                )}
              </div>
              {tabs.length < MAX_LAYOUTS - 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tBoard("newTab")}
                  title={tBoard("newTab")}
                  onClick={() => setNaming({ mode: "new", value: "", template: "empty" })}
                  data-testid="board-new-tab"
                  data-tutorial="admin-board-new-tab"
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
                    data-tutorial="admin-board-rename-tab"
                    onClick={() => setNaming({ mode: "rename", value: active.name ?? "", template: "empty" })}
                  >
                    <PencilIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tBoard("deleteTab")}
                    title={tBoard("deleteTab")}
                    data-tutorial="admin-board-delete-tab"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2Icon aria-hidden className="text-destructive" />
                  </Button>
                </>
              )}
              {boardKey === MAIN && canSetDefault && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingDefault(true)}
                  data-testid="admin-set-default"
                  data-tutorial="admin-set-default"
                >
                  <StarIcon aria-hidden data-icon="inline-start" />
                  {t("setDefault")}
                </Button>
              )}
            </div>
          }
          onReset={boardKey !== MAIN || mainRow?.items ? () => void reset() : undefined}
          resetLabel={
            boardKey === MAIN && initial.defaultFrom === "owner" ? t("resetOwner") : tBoard("reset")
          }
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
              void submitName(value);
              setNaming(null);
            }}
          >
            {naming?.mode === "new" && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-ink">{t("template")}</legend>
                <div className="flex flex-wrap gap-2" data-testid="admin-tab-templates">
                  {(["empty", ...templates] as const).map((template) => (
                    <button
                      key={template}
                      type="button"
                      aria-pressed={naming.template === template}
                      data-testid={`admin-tab-template-${template}`}
                      onClick={() =>
                        setNaming((previous) =>
                          previous && {
                            ...previous,
                            template,
                            // A ready set names the tab after itself, unless a name was typed.
                            value:
                              previous.value.trim() === "" ||
                              [...templates].some((key) => previous.value === t(`templates.${key}`))
                                ? template === "empty"
                                  ? ""
                                  : t(`templates.${template}`)
                                : previous.value,
                          },
                        )
                      }
                      className={cn(
                        "min-h-11 rounded-xl border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                        naming.template === template
                          ? "border-violet bg-violet/20 text-ink"
                          : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
                      )}
                    >
                      {t(`templates.${template}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
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
              const id = active.id;
              setDeleting(false);
              selectTab(MAIN);
              void deleteAdminLayout(id).then((result) => {
                if (result.ok) setLayouts((list) => list.filter((layout) => layout.id !== id));
                else setFailed(t("failed"));
              });
            }}
          />
        )}

        <ConfirmDialog
          open={settingDefault}
          onOpenChange={setSettingDefault}
          title={t("setDefault")}
          description={t("setDefaultConfirm")}
          confirmLabel={t("setDefault")}
          cancelLabel={tBoard("cancel")}
          closeLabel={tBoard("close")}
          onConfirm={() => {
            setSettingDefault(false);
            const items = editor.current() ?? editor.items ?? [];
            void setAdminDashboardDefault(items).then((result) => {
              if (result.ok) setDefaultSaved(true);
              else setFailed(t("failed"));
            });
          }}
        />
      </div>
    </AdminActorProvider>
  );
}
