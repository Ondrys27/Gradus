"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { CheckIcon, UserRoundIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { locales, type Locale } from "@/i18n/locales";
import { setSoundEnabled, useSoundEnabled } from "@/lib/sound-preference";
import { cn } from "@/lib/utils";

const itemClass =
  "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none mouse:min-h-9 data-highlighted:bg-surface-hover data-highlighted:text-ink";

export function AccountMenu() {
  const t = useTranslations("topBar.account");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const soundEnabled = useSoundEnabled();

  function changeLocale(next: Locale) {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("open")}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-9 place-items-center rounded-full border border-violet/50 bg-violet/15 text-violet transition-colors hover:bg-violet/25">
          <UserRoundIcon aria-hidden className="size-4.5" />
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup
            className={cn(
              "w-60 origin-(--transform-origin) rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <Menu.CheckboxItem
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
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
                value={locale}
                onValueChange={(value) => changeLocale(value as Locale)}
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
