"use client";

import { useState } from "react";
import { Gamepad2Icon, WrenchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useProfile } from "@/features/account/queries";
import { usePathList } from "@/features/game/overview-queries";
import { useChoosePath, useSetGameMode } from "@/features/game/queries";
import { localized, type GameMode } from "@/features/game/types";
import { GameIcon } from "@/features/game/unlock-icon";
import { APP_NAME } from "@/lib/constants";
import { ChoiceGrid, ChoiceTile, SettingRow, SettingsSection } from "./ui";

type Pending = { kind: "mode"; mode: GameMode } | { kind: "path"; pathKey: string };

/**
 * Settings → Work → Game: play the game or just use the app, and which path.
 * Both have consequences, so each switch first says what will happen.
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
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingRow id="settings-mode" label={t("modeLabel")} group layout="stack">
        <ChoiceGrid id="settings-mode" label={t("modeLabel")} columns={2}>
          {(["game", "tool"] as const).map((key) => (
            <ChoiceTile
              key={key}
              checked={mode === key}
              onSelect={() => ask({ kind: "mode", mode: key })}
              icon={key === "game" ? <Gamepad2Icon aria-hidden className="size-4" /> : <WrenchIcon aria-hidden className="size-4" />}
              title={t(`modes.${key}.title`)}
              description={t(`modes.${key}.description`)}
              className="items-start py-3"
            />
          ))}
        </ChoiceGrid>
      </SettingRow>

      {mode === "game" && (
        <SettingRow id="settings-path" label={t("pathLabel")} hint={t("pathHint")} group layout="stack">
          <ChoiceGrid id="settings-path" label={t("pathLabel")} columns={2}>
            {(paths.data ?? []).map((path) => (
              <ChoiceTile
                key={path.key}
                checked={profile.path_key === path.key}
                onSelect={() => ask({ kind: "path", pathKey: path.key })}
                icon={<GameIcon name={path.icon} className="size-4" />}
                title={localized(path.name, locale)}
              />
            ))}
          </ChoiceGrid>
        </SettingRow>
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
                    t(`confirm.${pending.mode}.${point}`, { appName: APP_NAME }),
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
    </SettingsSection>
  );
}
