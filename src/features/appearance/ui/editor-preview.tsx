"use client";

import { useTranslations } from "next-intl";
import { CalendarIcon, TrophyIcon, UsersIcon, XIcon } from "lucide-react";
import { BackdropLayers } from "@/components/layout/background";
import { Button } from "@/components/ui/button";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { AppearanceView } from "../custom-tokens";
import { themedProps } from "./theme-miniature";

export const PREVIEW_SCENES = ["dashboard", "pipeline", "note", "dialog"] as const;
export type PreviewScene = (typeof PREVIEW_SCENES)[number];

/**
 * The live preview of the custom theme editor: the app's own parts (cards,
 * tiles, pills, buttons, fields) laid out as the dashboard, the pipeline, a
 * note and a dialog, painted with the theme being edited. Sample content
 * only, nothing is read or written.
 */
export function EditorPreview({ view, scene }: { view: AppearanceView; scene: PreviewScene }) {
  return (
    <div
      {...themedProps(view)}
      data-testid="theme-editor-preview"
      className="theme-preview-smooth relative isolate h-full overflow-hidden md:min-h-[420px] rounded-2xl border border-line bg-canvas text-ink-soft"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <BackdropLayers size="box" />
      </div>
      <div className="flex h-full">
        <aside className="hidden w-44 shrink-0 flex-col gap-1 border-r border-line bg-canvas-deep/70 p-3 lg:flex">
          <span className="mb-3 size-6 rounded-md bg-linear-to-br from-violet to-teal" />
          {["a", "b", "c", "d", "e"].map((key, index) => (
            <span
              key={key}
              className={cn(
                "h-8 rounded-lg",
                index === 0 ? "bg-violet/15 ring-1 ring-violet/30" : "bg-surface/40",
              )}
            />
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {scene === "dashboard" && <DashboardScene />}
          {scene === "pipeline" && <PipelineScene />}
          {scene === "note" && <NoteScene />}
          {scene === "dialog" && <DialogScene />}
        </div>
      </div>
    </div>
  );
}

function DashboardScene() {
  const t = useTranslations("settings.appearance.editor.sample");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="page-title text-2xl">{t("dashboardTitle")}</h2>
        <Button size="sm">{t("primary")}</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t("contacts")} value={128} icon={<UsersIcon />} tone="violet" />
        <StatTile label={t("meetings")} value={6} icon={<CalendarIcon />} tone="teal" />
        <StatTile label={t("won")} value={3} icon={<TrophyIcon />} tone="gold" />
      </div>
      <GlowCard interactive={false} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{t("milestone")}</h3>
          <StatusPill tone="gold" dot>
            {t("inProgress")}
          </StatusPill>
        </div>
        <ProgressBar value={64} label={t("milestone")} />
        <p className="text-sm text-ink-muted">{t("milestoneHint")}</p>
      </GlowCard>
    </div>
  );
}

function PipelineScene() {
  const t = useTranslations("settings.appearance.editor.sample");
  const format = useFormatSettings();
  const columns = [
    { key: "lead", tone: "neutral", cards: 2 },
    { key: "meeting", tone: "violet", cards: 1 },
    { key: "offer", tone: "gold", cards: 2 },
    { key: "won", tone: "green", cards: 1 },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="page-title text-2xl">{t("pipelineTitle")}</h2>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {columns.map((column) => (
          <div key={column.key} className="flex flex-col gap-2 rounded-card border border-line bg-surface/50 p-2">
            <StatusPill tone={column.tone}>{t(`stages.${column.key}`)}</StatusPill>
            {Array.from({ length: column.cards }, (_, index) => (
              <GlowCard key={index} className="flex flex-col gap-1.5 p-3">
                <span className="text-sm font-medium text-ink">{t(`deals.${(index + column.key.length) % 3}`)}</span>
                <span className="text-xs text-ink-muted tabular-nums">
                  {formatCurrency(12_000 * (index + 2) * column.key.length, format.currency, format)}
                </span>
              </GlowCard>
            ))}
          </div>
        ))}
      </div>
      <p className="text-sm">
        <span className="text-green">{t("states.success")}</span> ·{" "}
        <span className="text-orange">{t("states.warning")}</span> ·{" "}
        <span className="text-pink">{t("states.danger")}</span>
      </p>
    </div>
  );
}

function NoteScene() {
  const t = useTranslations("settings.appearance.editor.sample");
  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <h2 className="page-title text-2xl">{t("noteTitle")}</h2>
      <h3 className="text-base font-semibold">{t("noteHeading")}</h3>
      <p className="text-sm leading-relaxed">{t("noteBody")}</p>
      <ul className="list-disc pl-5 text-sm leading-relaxed">
        <li>{t("notePoint1")}</li>
        <li>
          <span className="rounded-md bg-violet/15 px-1.5 py-0.5 text-violet">{t("noteMention")}</span> {t("notePoint2")}
        </li>
      </ul>
      <p className="text-xs text-ink-muted">{t("noteMeta")}</p>
      <a className="text-sm text-violet underline-offset-4 hover:underline" href="#preview" onClick={(e) => e.preventDefault()}>
        {t("link")}
      </a>
    </GlowCard>
  );
}

function DialogScene() {
  const t = useTranslations("settings.appearance.editor.sample");
  return (
    <div className="relative grid min-h-[340px] place-items-center">
      <div aria-hidden className="absolute inset-0 rounded-card bg-canvas/70" />
      <div className="relative w-full max-w-sm rounded-3xl border border-line-strong bg-surface p-6 shadow-popover">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{t("dialogTitle")}</h3>
          <XIcon aria-hidden className="size-5 text-ink-soft" />
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            {t("dialogField")}
            <Input readOnly value={t("dialogValue")} />
          </label>
          <p className="text-sm text-ink-muted">{t("dialogHint")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost">{t("cancel")}</Button>
            <Button>{t("primary")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
