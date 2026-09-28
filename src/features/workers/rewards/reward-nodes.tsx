"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";
import { ChevronLeftIcon, GiftIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { RewardBranch, RewardLeaf } from "./reward-tree";
import { TRIGGER_ICON, useRuleAmount } from "./rule-text";

/** Shared by the visible node and its twin in the measuring layer. */
const cardBase =
  "relative flex w-max max-w-[260px] min-w-[150px] items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left";

/** A tap that moved further than this was a pan, not a tap. */
const TAP_SLOP = 8;

/** Small round control on a node; the ::after keeps the touch target at 44 px. */
const miniButton =
  "relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted outline-none after:absolute after:-inset-2 after:content-[''] hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40";

const stop = (event: MouseEvent | PointerEvent) => event.stopPropagation();

/** Opens on a tap, not at the end of a pan across the map. */
function useTap(onTap: () => void) {
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: PointerEvent) => {
      pressedAt.current = { x: event.clientX, y: event.clientY };
    },
    onClick: (event: MouseEvent) => {
      const start = pressedAt.current;
      pressedAt.current = null;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
      onTap();
    },
  };
}

export function RewardRootNode({ ruleCount, onAdd }: { ruleCount: number; onAdd: () => void }) {
  const t = useTranslations("workers.rewards");
  const settings = useFormatSettings();
  return (
    <div
      className={cn(
        cardBase,
        "items-center border-gold bg-[color-mix(in_oklab,var(--color-gold)_14%,var(--color-surface))] shadow-[0_0_24px_-10px_var(--color-gold)]",
      )}
    >
      <GiftIcon aria-hidden className="size-5 shrink-0 text-gold" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold text-ink">{t("root")}</span>
        <span className="text-xs text-ink-soft">
          {t("ruleCount", { count: ruleCount, shown: formatNumber(ruleCount, {}, settings) })}
        </span>
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={t("addTrigger")}
        className={cn(miniButton, "-my-1 -mr-1.5")}
      >
        <PlusIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}

type BranchProps = {
  branch: RewardBranch;
  scope: string;
  collapsed: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onToggleCollapsed: () => void;
};

export function RewardBranchNode({
  branch,
  scope,
  collapsed,
  onOpen,
  onAdd,
  onToggleCollapsed,
}: BranchProps) {
  const t = useTranslations("workers.rewards");
  const settings = useFormatSettings();
  const Icon = TRIGGER_ICON[branch.trigger];
  const tap = useTap(onOpen);
  const label = t(`trigger.${branch.trigger}`);

  return (
    <div
      {...tap}
      className={cn(
        cardBase,
        "group cursor-pointer border-violet/80 bg-surface shadow-[0_0_22px_-10px_var(--color-violet)] hover:border-violet",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-violet" />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        aria-label={t("editTrigger", { trigger: label })}
        className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="truncate text-xs text-ink-soft">{scope}</span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
        onPointerDown={stop}
        aria-label={t("addRule", { trigger: label })}
        className={cn(miniButton, "-my-1 -mr-1.5")}
      >
        <PlusIcon aria-hidden className="size-4" />
      </button>
      {branch.leaves.length > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          onPointerDown={stop}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("expand", { count: branch.leaves.length }) : t("collapse")}
          className={cn(
            "absolute top-1/2 left-full z-10 grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-canvas-deep px-1 text-[11px] font-semibold text-ink-soft tabular-nums outline-none after:absolute after:-inset-2.5 after:content-[''] hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
            collapsed ? "border-violet text-ink" : "border-line-strong",
          )}
        >
          {collapsed ? (
            `+${formatNumber(branch.leaves.length, {}, settings)}`
          ) : (
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export function RewardLeafNode({ leaf, onOpen }: { leaf: RewardLeaf; onOpen: () => void }) {
  const t = useTranslations("workers.rewards");
  const amount = useRuleAmount();
  const tap = useTap(onOpen);
  const shown = amount(leaf.kind, leaf.amount);

  return (
    <div
      {...tap}
      className={cn(
        cardBase,
        "cursor-pointer flex-col gap-1 border-gold/60 bg-surface hover:border-gold",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        aria-label={t("editRule", { amount: shown })}
        className="flex w-full cursor-pointer flex-col rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <span className="font-semibold text-gold tabular-nums">{shown}</span>
        <span className="text-xs text-ink-muted">{t(`kind.${leaf.kind}`)}</span>
      </button>
      {leaf.note && (
        <span className="line-clamp-2 text-xs text-ink-soft [overflow-wrap:anywhere]">
          {leaf.note}
        </span>
      )}
    </div>
  );
}
