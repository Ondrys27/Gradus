"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { currencyDisplayName, currencyMatches, orderedCurrencies } from "@/lib/currency";
import { cn } from "@/lib/utils";

type Group = { value: "popular" | "all"; items: string[] };

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  /** The user's country: its currency comes first. */
  country?: string | null;
  disabled?: boolean;
  invalid?: boolean;
  /** Only the code on the button, for a narrow field next to an amount. */
  compact?: boolean;
  /** For a button without a visible label. */
  ariaLabel?: string;
  className?: string;
};

/**
 * Picks one of every currency in circulation: searchable by code and by name
 * in either language without diacritics ("jen", "yen", "JPY"), the country's
 * currency and the most used ones on top.
 */
export function CurrencyPicker({
  id,
  value,
  onChange,
  country,
  disabled,
  invalid,
  compact,
  ariaLabel,
  className,
}: Props) {
  const t = useTranslations("currency.picker");
  const locale = useLocale();
  const groups = useMemo<Group[]>(() => {
    const { popular, rest } = orderedCurrencies(country, value);
    return [
      { value: "popular", items: popular },
      { value: "all", items: rest },
    ];
  }, [country, value]);
  const label = (code: string) => `${code} · ${currencyDisplayName(code, locale)}`;

  return (
    <Combobox.Root
      items={groups}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
      itemToStringLabel={label}
      filter={(code: string, query: string) => currencyMatches(code, query, locale)}
      locale={locale}
    >
      <Combobox.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        data-testid="currency-picker"
        className={cn("field cursor-pointer justify-between gap-2 text-left", className)}
      >
        <span className="truncate">{compact ? value : label(value)}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-ink-muted transition-transform in-data-popup-open:rotate-180 motion-reduce:transition-none"
        />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-popover">
          <Combobox.Popup
            aria-label={t("label")}
            className={cn(
              "flex max-h-[min(var(--available-height),420px)] w-(--anchor-width) max-w-(--available-width) min-w-72 origin-(--transform-origin) flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-popover outline-none",
              "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
            )}
          >
            <div className="relative shrink-0 border-b border-line p-1.5">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-ink-muted"
              />
              <Combobox.Input
                placeholder={t("search")}
                aria-label={t("search")}
                className="field border-transparent bg-transparent pl-10 shadow-none"
              />
            </div>
            <Combobox.Empty className="px-4 py-3 text-sm text-ink-muted empty:hidden">
              {t("empty")}
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden">
              {(group: Group) => (
                <Combobox.Group key={group.value} items={group.items} className="pb-1.5 last:pb-0">
                  <Combobox.GroupLabel className="micro-label sticky top-0 z-1 bg-surface px-3 py-2">
                    {t(`groups.${group.value}`)}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(code: string) => (
                      <Combobox.Item
                        key={code}
                        value={code}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink data-selected:text-ink mouse:min-h-9"
                      >
                        <span className="w-10 shrink-0 font-medium tabular-nums">{code}</span>
                        <span className="min-w-0 truncate">{currencyDisplayName(code, locale)}</span>
                        <Combobox.ItemIndicator className="ml-auto text-violet">
                          <CheckIcon className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
