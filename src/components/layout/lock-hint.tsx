"use client";

import { useState, type ReactElement } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { FlagIcon, LockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useDefinitions } from "@/features/game/overview-queries";
import { isLockableSection, localized, SECTION_UNLOCK_KEYS } from "@/features/game/types";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { NavItemState } from "./use-nav";

/** What opens a locked section: the path milestone by name, or the level. */
export function LockHintText({ item }: { item: NavItemState }) {
  const t = useTranslations("nav.locked");
  const settings = useFormatSettings();
  const hint = item.lockHint;
  if (hint?.kind === "milestone") return t("milestone", { milestone: hint.title });
  if (hint?.kind === "level") return t("level", { level: formatNumber(hint.level, {}, settings) });
  return t("path");
}

/**
 * The card a locked menu item opens: the section, what it does, what unlocks
 * it and a button to the milestone that does.
 */
function LockedSectionCard({ item, onNavigate }: { item: NavItemState; onNavigate: () => void }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const definitions = useDefinitions();
  const definition = isLockableSection(item.key)
    ? definitions.data?.unlocks.get(SECTION_UNLOCK_KEYS[item.key])
    : undefined;
  const hint = item.lockHint;
  const href =
    hint?.kind === "milestone" && hint.milestoneId
      ? `/milestones/${hint.milestoneId}`
      : hint?.kind === "level"
        ? null
        : "/milestones?view=path";

  return (
    <div className="flex w-72 max-w-[calc(100vw-32px)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-line/50 text-ink-muted">
          <LockIcon aria-hidden className="size-5" />
        </span>
        <Popover.Title className="text-base font-semibold text-ink">{t(item.key)}</Popover.Title>
      </div>
      {definition && (
        <Popover.Description className="text-sm text-ink-soft">
          {localized(definition.description, locale)}
        </Popover.Description>
      )}
      <p className="text-sm font-medium text-gold">
        <LockHintText item={item} />
      </p>
      {href && (
        <Link
          href={href}
          onClick={onNavigate}
          className={cn(buttonVariants({ size: "sm" }), "min-h-11 self-start mouse:min-h-9")}
        >
          <FlagIcon aria-hidden data-icon="inline-start" />
          {hint?.kind === "milestone" ? t("locked.openMilestone") : t("locked.openPath")}
        </Link>
      )}
    </div>
  );
}

/**
 * A locked menu item: dimmed, with a lock; a tap (or hover with a mouse)
 * opens the card. The trigger element is the caller's.
 */
export function LockedSectionPopover({
  item,
  side,
  trigger,
  onNavigate,
}: {
  item: NavItemState;
  side: "right" | "top";
  trigger: ReactElement<Record<string, unknown>>;
  /** Called after the card's button navigates (e.g. to close a sheet it sits in). */
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger openOnHover={side === "right"} delay={150} render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side={side} sideOffset={8} collisionPadding={16} className="z-popover">
          <Popover.Popup className="rounded-2xl border border-line-strong bg-surface p-4 shadow-popover outline-none">
            <LockedSectionCard
              item={item}
              onNavigate={() => {
                setOpen(false);
                onNavigate?.();
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
