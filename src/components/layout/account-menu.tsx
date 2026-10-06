"use client";

import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { CheckIcon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import {
  useProfile,
  useSession,
  useSignOut,
  useUpdateSettings,
  useUserSettings,
} from "@/features/account/queries";
import { locales } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const itemClass =
  "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none mouse:min-h-9 data-highlighted:bg-surface-hover data-highlighted:text-ink";

export function AccountMenu() {
  const t = useTranslations("topBar.account");
  const { user } = useSession();
  const profile = useProfile();
  const settings = useUserSettings();
  const updateSettings = useUpdateSettings();
  const signOut = useSignOut();
  const name = profile.display_name || profile.username || user.email;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("open")}
        data-tour="account"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Avatar
          src={profile.avatar_url}
          name={name}
          className="transition-colors hover:bg-violet/25"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-popover">
          <Menu.Popup
            className={cn(
              "w-64 origin-(--transform-origin) rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Avatar src={profile.avatar_url} name={name} className="size-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{name}</p>
                {name !== user.email && (
                  <p className="truncate text-xs text-ink-muted">{user.email}</p>
                )}
              </div>
            </div>

            <Menu.Separator className="my-1.5 h-px bg-line" />

            <Menu.LinkItem closeOnClick render={<Link href="/app/profil" />} className={itemClass}>
              {t("profile")}
              <UserRoundIcon aria-hidden className="size-4 text-ink-muted" />
            </Menu.LinkItem>
            <Menu.LinkItem closeOnClick render={<Link href="/app/nastaveni" />} className={itemClass}>
              {t("settings")}
              <SettingsIcon aria-hidden className="size-4 text-ink-muted" />
            </Menu.LinkItem>

            <Menu.Separator className="my-1.5 h-px bg-line" />

            <Menu.CheckboxItem
              checked={settings.sound_enabled}
              onCheckedChange={(checked) => updateSettings.mutate({ sound_enabled: checked })}
              className={itemClass}
            >
              {t("sound")}
              <Menu.CheckboxItemIndicator className="text-violet">
                <CheckIcon className="size-4" />
              </Menu.CheckboxItemIndicator>
            </Menu.CheckboxItem>

            <Menu.Separator className="my-1.5 h-px bg-line" />

            <Menu.Group>
              <Menu.GroupLabel className="micro-label px-3 py-1.5">{t("language")}</Menu.GroupLabel>
              <Menu.RadioGroup
                value={settings.locale}
                onValueChange={(value) => updateSettings.mutate({ locale: value as string })}
              >
                {locales.map((code) => (
                  <Menu.RadioItem key={code} value={code} className={itemClass}>
                    {t(`languages.${code}`)}
                    <Menu.RadioItemIndicator className="text-violet">
                      <CheckIcon className="size-4" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>

            <Menu.Separator className="my-1.5 h-px bg-line" />

            <Menu.Item onClick={signOut} className={cn(itemClass, "data-highlighted:text-pink")}>
              {t("signOut")}
              <LogOutIcon aria-hidden className="size-4" />
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
