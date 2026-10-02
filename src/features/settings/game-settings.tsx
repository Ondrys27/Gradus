"use client";

import { useState } from "react";
import { CheckIcon, Gamepad2Icon, WrenchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useProfile } from "@/features/account/queries";
import { usePathList } from "@/features/game/overview-queries";
import { useChoosePath, useSetGameMode } from "@/features/game/queries";
import { localized, type GameMode } from "@/features/game/types";
import { GameIcon } from "@/features/game/unlock-icon";
import { cn } from "@/lib/utils";

type Pending = { kind: "mode"; mode: GameMode } | { kind: "path"; pathKey: string };

/**
 * Settings → Game: play the game or just use the app, and which path. Every
 * switch first says what will happen.
 */
export function GameSettings() {
  const t = useTranslations("settings.game");
  const locale = useLocale();
  const profile = useProfile();
  const paths = usePathList();
  const setMode = useSetGameMode();
  const choosePath = useChoosePath();
  const [pending, setPending] = useState<Pending | null>(null);
  const mode: GameMode = profile.mode === "tool" ? "tool" : "game";
  const busy = setMode.isPending || choosePath.isPending;
  const failed = setMode.isError || choosePath.isError;

  function ask(next: Pending) {
    setMode.reset();
    choosePath.reset();
    setPending(next);
  }

  function confirm() {
    if (!pending) return;
    const close = { onSuccess: () => setPending(null) };
    if (pending.kind === "mode") setMode.mutate(pending.mode, close);
    else choosePath.mutate(pending.pathKey, close);
  }

  const pendingPath =
    pending?.kind === "path" ? paths.data?.find((path) => path.key === pending.pathKey) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div role="radiogroup" aria-label={t("modeLabel")} className="grid gap-3 sm:grid-cols-2">
        {(["game", "tool"] as const).map((key) => {
          const checked = mode === key;
          const Icon = key === "game" ? Gamepad2Icon : WrenchIcon;
          return (
            <button
              key={key}
              id={key === "game" ? "settings-mode" : undefined}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => {
                if (!checked) ask({ kind: "mode", mode: key });
              }}
              className={cn(
                "flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                checked
                  ? "border-violet/60 bg-violet/15 shadow-glow"
                  : "border-line bg-canvas-deep/60 hover:border-line-strong",
              )}
            >
              <Icon
                aria-hidden
                className={cn("mt-0.5 size-5 shrink-0", checked ? "text-violet" : "text-ink-muted")}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[15px] font-semibold text-ink">
                  {t(`modes.${key}.title`)}
                </span>
                <span className="text-xs text-ink-soft">{t(`modes.${key}.description`)}</span>
              </span>
              {checked && <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />}
            </button>
          );
        })}
      </div>

      {mode === "game" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-medium text-ink">{t("pathLabel")}</h3>
            <p className="text-xs text-ink-muted">{t("pathHint")}</p>
          </div>
          <div role="radiogroup" aria-label={t("pathLabel")} className="grid gap-2 sm:grid-cols-3">
            {(paths.data ?? []).map((path) => {
              const checked = profile.path_key === path.key;
              return (
                <button
                  key={path.key}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => {
                    if (!checked) ask({ kind: "path", pathKey: path.key });
                  }}
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    checked
                      ? "border-violet/60 bg-violet/15 text-ink shadow-glow"
                      : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
                  )}
                >
                  <GameIcon name={path.icon} className="size-5 shrink-0 text-violet" />
                  <span className="min-w-0 flex-1">{localized(path.name, locale)}</span>
                  {checked && <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <ResponsiveDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
        title={
          pending?.kind === "mode"
            ? t(`confirm.${pending.mode}.title`)
            : t("confirm.path.title", {
                path: pendingPath ? localized(pendingPath.name, locale) : "",
              })
        }
        closeLabel={t("confirm.close")}
      >
        <div className="flex flex-col gap-5">
          {pending && (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-soft">
              {(pending.kind === "mode"
                ? (["point1", "point2", "point3"] as const).map((point) =>
                    t(`confirm.${pending.mode}.${point}`),
                  )
                : (["point1", "point2", "point3"] as const).map((point) =>
                    t(`confirm.path.${point}`),
                  )
              ).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          {failed && <FormAlert>{t("confirm.failed")}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              {t("confirm.cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={confirm}>
              {pending?.kind === "mode"
                ? t(`confirm.${pending.mode}.action`)
                : t("confirm.path.action")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
