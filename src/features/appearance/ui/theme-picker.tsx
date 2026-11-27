"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants, Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { accountKeys, useSession, useUserSettings } from "@/features/account/queries";
import { useSettingsSave } from "@/features/settings/save-state";
import { track } from "@/lib/analytics/client";
import { formatNumber } from "@/lib/format";
import { THEMES } from "@/lib/themes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { CUSTOM_THEME_NAME_MAX, CUSTOM_THEMES_MAX } from "../custom-tokens";
import {
  appearanceKeys,
  saveErrorCode,
  useCustomThemesAllowed,
  useDeleteCustomTheme,
  useSaveCustomTheme,
  type CustomTheme,
} from "../queries";
import { manualPickPatch, parseThemeSchedule, resolveRef, withoutMissingThemes } from "../schedule";
import { parseShareCode, SHARE_PARAM, THEME_EDITOR_PATH } from "../share";
import { customRef } from "../theme-ref";
import { ImportThemeDialog, ShareThemeDialog } from "./share-dialogs";
import { ThemeMiniature } from "./theme-miniature";
import { useThemeOptions, type ThemeOption } from "./use-theme-options";

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

/** How often the picker looks at the clock, so a block that begins while it is open is shown. */
const CLOCK_STEP_MS = 20_000;

function subscribeClock(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, CLOCK_STEP_MS);
  return () => window.clearInterval(timer);
}

/** Now, in steps (a stable snapshot between ticks); null on the server and while hydrating. */
function useClockStep(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS,
    () => null,
  );
}

/** The name of a duplicate: "… (copy)", cut to fit. */
function copyName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  return `${name.slice(0, Math.max(1, CUSTOM_THEME_NAME_MAX - tail.length)).trimEnd()}${tail}`;
}

/**
 * Settings → Appearance: the six built-in themes (in game mode a locked one
 * shows its level) and the user's custom ones, each as a miniature of the
 * app. A pick while the schedule is on holds until the next block begins.
 * Custom themes: create, edit, duplicate, share, delete, import a colleague's.
 */
export function ThemePicker() {
  const t = useTranslations("settings.appearance");
  // What the picker shows depends on the clock (the block in charge) and on data only the browser
  // loads (custom themes, unlocked themes), which may already be cached when a late boundary
  // hydrates: until hydration both sides draw the same placeholder.
  const now = useClockStep();
  if (now === null) {
    return (
      <div className="flex flex-col gap-3">
        <div
          id="settings-theme"
          tabIndex={-1}
          role="radiogroup"
          aria-label={t("title")}
          aria-busy
          className="grid grid-cols-2 gap-2 rounded-xl outline-none sm:grid-cols-3"
        >
          {THEMES.map((theme) => (
            <Skeleton key={theme} className="aspect-[5/3] w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  return <ThemePickerBody now={now} />;
}

function ThemePickerBody({ now }: { now: number }) {
  const t = useTranslations("settings.appearance");
  const settings = useUserSettings();
  const format = useFormatSettings();
  const { save } = useSettingsSave();
  const options = useThemeOptions();
  const allowed = useCustomThemesAllowed().data !== false;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sharing, setSharing] = useState<CustomTheme | null>(null);
  const [deleting, setDeleting] = useState<CustomTheme | null>(null);
  const linkCode = parseShareCode(params.get(SHARE_PARAM) ?? "");
  const [importing, setImporting] = useState(linkCode !== null);
  useEffect(() => {
    if (linkCode) setImporting(true);
  }, [linkCode]);

  const resolved = resolveRef(settings, now);
  const shown =
    options.find((option) => option.ref === resolved.ref && option.available)?.ref ?? "gradus";
  const customCount = options.filter((option) => option.custom).length;
  const full = customCount >= CUSTOM_THEMES_MAX;

  const pick = (option: ThemeOption) => {
    if (!option.available || option.ref === shown) return;
    save(manualPickPatch(option.ref, settings, Date.now()));
  };

  const closeImport = () => {
    setImporting(false);
    if (params.has(SHARE_PARAM)) router.replace(pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        id="settings-theme"
        tabIndex={-1}
        role="radiogroup"
        aria-label={t("title")}
        className="grid grid-cols-2 gap-2 rounded-xl outline-none sm:grid-cols-3"
      >
        {options.map((option) => {
          const checked = shown === option.ref;
          return (
            <div key={option.ref} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={!option.available}
                data-theme-option={option.ref}
                onClick={() => pick(option)}
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                  checked ? "border-violet/60 bg-violet/10" : "border-line",
                  option.available
                    ? "cursor-pointer hover:border-line-strong"
                    : "cursor-not-allowed",
                )}
              >
                <ThemeMiniature view={option.view} dimmed={!option.available} />
                <span
                  className={cn(
                    "flex min-h-6 items-center justify-between gap-2 px-1",
                    option.custom && "pr-9",
                  )}
                >
                  <span className="truncate text-[13px] font-medium text-ink">{option.label}</span>
                  {checked ? (
                    <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />
                  ) : !option.available ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                      <LockIcon aria-hidden className="size-3" />
                      {option.level
                        ? t("level", { level: formatNumber(option.level, {}, format) })
                        : t("locked")}
                    </span>
                  ) : null}
                </span>
              </button>
              {option.custom && (
                <CustomThemeMenu
                  theme={option.custom}
                  canDuplicate={allowed && !full}
                  onShare={() => setSharing(option.custom)}
                  onDelete={() => setDeleting(option.custom)}
                />
              )}
            </div>
          );
        })}
      </div>

      {resolved.source === "schedule" && (
        <p className="text-[13px] text-ink-muted">
          {t("pickDuringBlock", { block: resolved.active.block.name })}
        </p>
      )}

      <div
        id="settings-custom-themes"
        tabIndex={-1}
        className="flex flex-wrap items-center gap-2 rounded-xl outline-none"
      >
        {allowed && !full && (
          <Link
            href={THEME_EDITOR_PATH}
            data-testid="create-custom-theme"
            className={buttonVariants({ variant: "secondary" })}
          >
            <PlusIcon aria-hidden />
            {t("create")}
          </Link>
        )}
        {allowed && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setImporting(true)}
            data-testid="import-custom-theme"
          >
            <DownloadIcon aria-hidden />
            {t("importAction")}
          </Button>
        )}
        {full && (
          <span className="text-[13px] text-ink-muted">
            {t("full", { max: CUSTOM_THEMES_MAX })}
          </span>
        )}
        {!allowed && <span className="text-[13px] text-ink-muted">{t("notInPlan")}</span>}
      </div>

      <ShareThemeDialog theme={sharing} onClose={() => setSharing(null)} />
      <ImportThemeDialog
        open={importing}
        initialCode={linkCode}
        onClose={closeImport}
        onImported={(theme) => {
          closeImport();
          save(manualPickPatch(customRef(theme.id), settings, Date.now()));
        }}
      />
      <DeleteThemeDialog theme={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CustomThemeMenu({
  theme,
  canDuplicate,
  onShare,
  onDelete,
}: {
  theme: CustomTheme;
  canDuplicate: boolean;
  onShare: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings.appearance");
  const router = useRouter();
  const duplicate = useSaveCustomTheme();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("menu", { name: theme.name })}
        data-testid="custom-theme-menu"
        className="absolute right-1.5 bottom-1 grid size-11 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
      >
        <EllipsisIcon aria-hidden className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-48 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item
              className={itemClass}
              onClick={() => router.push(`${THEME_EDITOR_PATH}?id=${theme.id}`)}
            >
              <PencilIcon aria-hidden />
              {t("edit")}
            </Menu.Item>
            {canDuplicate && (
              <Menu.Item
                className={itemClass}
                onClick={() =>
                  duplicate.mutate(
                    { name: copyName(theme.name, t("copySuffix")), tokens: theme.tokens },
                    {
                      onSuccess: (copy) =>
                        track("custom_theme_saved", {
                          action: "duplicated",
                          base: copy.tokens.base,
                          generated: false,
                          fixes: 0,
                        }),
                    },
                  )
                }
              >
                <CopyIcon aria-hidden />
                {t("duplicate")}
              </Menu.Item>
            )}
            <Menu.Item className={itemClass} onClick={onShare}>
              <Share2Icon aria-hidden />
              {t("shareAction")}
            </Menu.Item>
            <Menu.Item
              className={cn(itemClass, "text-destructive data-highlighted:text-destructive")}
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden />
              {t("delete")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Deleting a custom theme: the blocks that used it fall back to the default (the pick is cleared by the database). */
function DeleteThemeDialog({ theme, onClose }: { theme: CustomTheme | null; onClose: () => void }) {
  const t = useTranslations("settings.appearance");
  const settings = useUserSettings();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { save } = useSettingsSave();
  const remove = useDeleteCustomTheme();
  return (
    <ConfirmDialog
      open={theme !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle")}
      description={t("deleteDescription", { name: theme?.name ?? "" })}
      confirmLabel={t("delete")}
      cancelLabel={t("cancel")}
      closeLabel={t("close")}
      pending={remove.isPending}
      error={
        remove.error
          ? t(`import.errors.${saveErrorCode(remove.error)}`, { max: CUSTOM_THEMES_MAX })
          : null
      }
      onConfirm={() => {
        if (!theme) return;
        remove.mutate(theme.id, {
          onSuccess: (id) => {
            track("custom_theme_deleted", {});
            onClose();
            const schedule = parseThemeSchedule(settings.theme_schedule);
            const remaining = new Set(
              (queryClient.getQueryData<CustomTheme[]>(appearanceKeys.customThemes(user.id)) ?? [])
                .map((item) => item.id)
                .filter((item) => item !== id),
            );
            const cleaned = schedule ? withoutMissingThemes(schedule, remaining) : null;
            if (schedule && cleaned && cleaned !== schedule) save({ theme_schedule: cleaned });
            else void queryClient.invalidateQueries({ queryKey: accountKeys.settings(user.id) });
          },
        });
      }}
    />
  );
}
