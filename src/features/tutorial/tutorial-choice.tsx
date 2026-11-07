"use client";

import { CheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Jarvis } from "@/components/jarvis/jarvis";
import { SpeechBubble } from "@/components/jarvis/speech-bubble";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { TUTORIAL_MINUTES } from "./steps";
import type { RunningMode, TutorialMode } from "./types";

/** The three lines of "what you'll be able to do" on each card. */
const LEARN = [0, 1, 2] as const;

/**
 * "How do you want to start?": the quick look (only looking) or the full
 * tutorial on sample data as two cards that differ at a glance (a small
 * preview, the time, what you'll be able to do), and skipping as a quiet
 * line underneath. At the end of onboarding (after the celebration) and
 * whenever asked for (Settings → Jarvis, Jarvis's panel). The full one only
 * in the user's own space while it can be written to.
 */
export function TutorialChoice({
  open,
  allowFull,
  pending,
  failed,
  onChoose,
  onClose,
}: {
  open: boolean;
  allowFull: boolean;
  /** Which mode is being started (the sample data takes a moment). */
  pending: TutorialMode | null;
  failed: boolean;
  onChoose: (mode: TutorialMode) => void;
  onClose: () => void;
}) {
  const t = useTranslations("tutorial.choice");
  const modes: RunningMode[] = allowFull ? ["quick", "full"] : ["quick"];
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,760px)]"
    >
      <div data-testid="tutorial-choice" className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <div className="shrink-0">
            <Jarvis size={64} state="waving" variant="head" />
          </div>
          <SpeechBubble tail={{ side: "left", align: "end" }} className="flex-1">
            <p className="text-[15px] leading-relaxed text-ink">{t("intro")}</p>
          </SpeechBubble>
        </div>
        <ul
          className={cn("grid gap-3", modes.length === 2 ? "md:grid-cols-2" : "md:max-w-[360px]")}
        >
          {modes.map((mode) => (
            <li key={mode} className="flex">
              <ModeCard mode={mode} pending={pending} onChoose={onChoose} />
            </li>
          ))}
        </ul>
        <button
          type="button"
          data-tutorial-choice="none"
          disabled={pending !== null}
          onClick={() => onChoose("none")}
          className="-mb-1 flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 text-center outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-60"
        >
          <span className="text-sm font-semibold text-ink-soft">{t("none.title")}</span>
          <span className="text-xs text-ink-muted">{t("none.text")}</span>
        </button>
        {failed && <FormAlert>{t("failed")}</FormAlert>}
      </div>
    </ResponsiveDialog>
  );
}

function ModeCard({
  mode,
  pending,
  onChoose,
}: {
  mode: RunningMode;
  pending: TutorialMode | null;
  onChoose: (mode: TutorialMode) => void;
}) {
  const t = useTranslations("tutorial.choice");
  const full = mode === "full";
  return (
    <button
      type="button"
      data-tutorial-choice={mode}
      disabled={pending !== null}
      onClick={() => onChoose(mode)}
      className={cn(
        "group relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-60",
        full
          ? "border-violet/60 bg-violet/10 hover:bg-violet/15"
          : "border-line-strong bg-surface hover:bg-surface-hover",
      )}
    >
      {full ? (
        <FullPreview label={t("full.previewAlt")} />
      ) : (
        <QuickPreview label={t("quick.previewAlt")} />
      )}
      <span className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-ink">{t(`${mode}.title`)}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
            full ? "bg-violet/20 text-violet" : "bg-teal/15 text-teal",
          )}
        >
          {t("minutes", { minutes: TUTORIAL_MINUTES[mode] })}
        </span>
      </span>
      <span className="text-sm text-ink-soft">{t(`${mode}.text`)}</span>
      <span className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          {t("learnTitle")}
        </span>
        {LEARN.map((line) => (
          <span key={line} className="flex items-start gap-1.5 text-sm text-ink">
            <CheckIcon
              aria-hidden
              className={cn("mt-0.5 size-4 shrink-0", full ? "text-violet" : "text-teal")}
            />
            {t(`${mode}.learn.${line}`)}
          </span>
        ))}
      </span>
      {full && (
        <span className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-gold">
          <SparklesIcon aria-hidden className="size-3.5" />
          {t("full.gain")}
        </span>
      )}
      {full && (
        <span className="absolute top-3 left-3 rounded-full bg-violet px-2 py-0.5 text-[11px] font-semibold text-white shadow-popover">
          {t("recommended")}
        </span>
      )}
      {pending === mode && (
        <span role="status" className="text-xs font-semibold text-teal">
          {t("preparing")}
        </span>
      )}
    </button>
  );
}

/** A small app frame: the menu with one item lit and Jarvis pointing at it. */
function QuickPreview({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="relative block overflow-hidden rounded-xl border border-line bg-canvas"
    >
      <svg
        viewBox="0 0 240 120"
        preserveAspectRatio="xMidYMin slice"
        className="block h-24 w-full md:h-auto"
        aria-hidden
      >
        <rect x="0" y="0" width="64" height="120" className="fill-surface" />
        <rect x="10" y="12" width="36" height="6" rx="3" className="fill-line-strong" />
        <rect x="10" y="30" width="44" height="6" rx="3" className="fill-line" />
        <rect
          x="6"
          y="42"
          width="52"
          height="14"
          rx="5"
          className="fill-violet/30 stroke-teal"
          strokeWidth="1.5"
        />
        <rect x="12" y="46" width="30" height="6" rx="3" className="fill-ink" />
        <rect x="10" y="66" width="40" height="6" rx="3" className="fill-line" />
        <rect x="10" y="82" width="34" height="6" rx="3" className="fill-line" />
        <rect x="10" y="98" width="42" height="6" rx="3" className="fill-line" />
        <rect x="80" y="14" width="80" height="9" rx="4" className="fill-line-strong" />
        <rect x="80" y="30" width="120" height="5" rx="2.5" className="fill-line" />
        <rect x="80" y="48" width="66" height="36" rx="8" className="fill-surface stroke-line" />
        <rect x="156" y="48" width="66" height="36" rx="8" className="fill-surface stroke-line" />
        <rect x="88" y="56" width="30" height="5" rx="2.5" className="fill-line" />
        <rect x="88" y="68" width="18" height="9" rx="3" className="fill-teal/70" />
        <rect x="164" y="56" width="30" height="5" rx="2.5" className="fill-line" />
        <rect x="164" y="68" width="18" height="9" rx="3" className="fill-teal/70" />
        <rect x="80" y="92" width="142" height="18" rx="6" className="fill-surface stroke-line" />
        <rect x="64" y="0" width="176" height="120" className="fill-black/35" />
      </svg>
      <span className="absolute bottom-1 left-[68px]">
        <Jarvis size={44} state="pointing" direction="up-left" />
      </span>
    </span>
  );
}

/** A small app frame: a task list where the user ticks things off, with a sample label. */
function FullPreview({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="relative block overflow-hidden rounded-xl border border-violet/40 bg-canvas"
    >
      <svg
        viewBox="0 0 240 120"
        preserveAspectRatio="xMidYMin slice"
        className="block h-24 w-full md:h-auto"
        aria-hidden
      >
        <rect x="0" y="0" width="64" height="120" className="fill-surface" />
        <rect x="10" y="12" width="36" height="6" rx="3" className="fill-line-strong" />
        <rect x="10" y="30" width="44" height="6" rx="3" className="fill-line" />
        <rect x="10" y="46" width="30" height="6" rx="3" className="fill-line" />
        <rect x="10" y="62" width="40" height="6" rx="3" className="fill-line" />
        <rect x="80" y="12" width="92" height="9" rx="4" className="fill-ink" />
        <rect
          x="178"
          y="10"
          width="40"
          height="13"
          rx="6.5"
          className="fill-gold/20 stroke-gold/60"
        />
        <rect x="186" y="15" width="24" height="3" rx="1.5" className="fill-gold" />
        <rect x="80" y="30" width="142" height="6" rx="3" className="fill-line" />
        <rect x="80" y="30" width="86" height="6" rx="3" className="fill-teal" />
        {[48, 70, 92].map((y, row) => (
          <g key={y}>
            <rect
              x="80"
              y={y}
              width="142"
              height="16"
              rx="6"
              className="fill-surface stroke-line"
            />
            <circle
              cx="92"
              cy={y + 8}
              r="5"
              className={row < 2 ? "fill-green stroke-green" : "fill-none stroke-line-strong"}
              strokeWidth="1.5"
            />
            {row < 2 && (
              <path
                d={`M89.5 ${y + 8} l2 2 l3.5 -4`}
                className="stroke-canvas"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <rect
              x="104"
              y={y + 5}
              width={row === 1 ? 70 : 54}
              height="6"
              rx="3"
              className={row < 2 ? "fill-ink-muted" : "fill-ink"}
            />
          </g>
        ))}
        <path
          d="M150 104 l0 12 l3 -3 l3 5 l2 -1 l-3 -5 l4 -1 z"
          className="fill-white stroke-black/60"
          strokeWidth="0.8"
        />
      </svg>
      <span className="absolute right-1 bottom-1">
        <Jarvis size={40} state="happy" variant="head" />
      </span>
    </span>
  );
}
