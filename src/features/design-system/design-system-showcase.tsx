"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CoinsIcon,
  InboxIcon,
  PercentIcon,
  RotateCcwIcon,
  SparklesIcon,
  TrophyIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { JarvisBot, type JarvisState } from "@/components/jarvis/jarvis-bot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowCard } from "@/components/ui/glow-card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing } from "@/components/ui/progress-ring";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { formatNumber, type IsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const colorTokens = [
  { token: "canvas", swatch: "bg-canvas", role: "canvas" },
  { token: "canvas-deep", swatch: "bg-canvas-deep", role: "canvasDeep" },
  { token: "surface", swatch: "bg-surface", role: "surface" },
  { token: "surface-hover", swatch: "bg-surface-hover", role: "surfaceHover" },
  { token: "grid", swatch: "bg-grid", role: "grid" },
  { token: "line", swatch: "bg-line", role: "line" },
  { token: "line-strong", swatch: "bg-line-strong", role: "lineStrong" },
  { token: "violet", swatch: "bg-violet", role: "violet" },
  { token: "teal", swatch: "bg-teal", role: "teal" },
  { token: "gold", swatch: "bg-gold", role: "gold" },
  { token: "green", swatch: "bg-green", role: "green" },
  { token: "pink", swatch: "bg-pink", role: "pink" },
  { token: "ink", swatch: "bg-ink", role: "ink" },
  { token: "ink-soft", swatch: "bg-ink-soft", role: "inkSoft" },
  { token: "ink-muted", swatch: "bg-ink-muted", role: "inkMuted" },
] as const;

const stages = ["lead", "contacted", "meeting", "won"] as const;
const jarvisStates: JarvisState[] = ["idle", "thinking", "happy"];

export function DesignSystemShowcase() {
  const t = useTranslations("designSystem");
  const [countKey, setCountKey] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate | null>(null);
  const [notify, setNotify] = useState(true);
  const [done, setDone] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-8 md:px-8 md:py-12">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="outline">{t("buttons.secondary")}</Button>
            <Button>
              <SparklesIcon data-icon="inline-start" />
              {t("buttons.primary")}
            </Button>
          </>
        }
      />

      <Section title={t("sections.colors")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {colorTokens.map(({ token, swatch, role }) => (
            <Swatch key={token} token={token} swatch={swatch} role={t(`colors.${role}`)} />
          ))}
        </div>
      </Section>

      <Section title={t("sections.typography")}>
        <GlowCard interactive={false} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="micro-label">{t("typography.pageTitleSpec")}</span>
            <p className="page-title">{t("typography.pageTitle")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="micro-label">{t("typography.statSpec")}</span>
            <p className="stat-number text-ink">{formatNumber(12480)}</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="micro-label">{t("typography.microSpec")}</span>
            <p className="micro-label">{t("typography.microLabel")}</p>
          </div>
          <p className="text-base text-ink-soft">{t("typography.body")}</p>
          <p className="text-sm text-ink-muted">{t("typography.muted")}</p>
        </GlowCard>
      </Section>

      <Section title={t("sections.cards")}>
        <div className="grid gap-4 md:grid-cols-2">
          <GlowCard>
            <h3 className="font-semibold">{t("cards.interactiveTitle")}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t("cards.interactiveBody")}</p>
          </GlowCard>
          <GlowCard interactive={false}>
            <h3 className="font-semibold">{t("cards.staticTitle")}</h3>
            <p className="mt-1 text-sm text-ink-muted">{t("cards.staticBody")}</p>
          </GlowCard>
        </div>
      </Section>

      <Section
        title={t("sections.stats")}
        action={
          <Button variant="ghost" size="sm" onClick={() => setCountKey((k) => k + 1)}>
            <RotateCcwIcon data-icon="inline-start" />
            {t("stats.replay")}
          </Button>
        }
      >
        <div key={countKey} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("stats.xp")}
            value={2450}
            tone="gold"
            icon={<SparklesIcon />}
            hint={t("stats.xpHint")}
          />
          <StatTile label={t("stats.won")} value={18} tone="green" icon={<TrophyIcon />} />
          <StatTile
            label={t("stats.conversion")}
            value={0.342}
            format={{ style: "percent", decimals: 1 }}
            tone="teal"
            icon={<PercentIcon />}
          />
          <StatTile
            label={t("stats.revenue")}
            value={184500}
            format={{ style: "currency" }}
            tone="violet"
            icon={<CoinsIcon />}
          />
        </div>
      </Section>

      <Section title={t("sections.progress")}>
        <GlowCard interactive={false} className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex flex-1 flex-col gap-5">
            <ProgressRow label={t("progress.milestone")} value={0.64}>
              <ProgressBar label={t("progress.milestone")} value={64} />
            </ProgressRow>
            <ProgressRow label={t("progress.level")} value={0.32}>
              <ProgressBar label={t("progress.level")} value={32} tone="reward" />
            </ProgressRow>
            <ProgressRow label={t("progress.overBudget")} value={0.9}>
              <ProgressBar label={t("progress.overBudget")} value={90} tone="danger" size="sm" />
            </ProgressRow>
          </div>
          <div className="flex items-center gap-6 self-center">
            <ProgressRing label={t("progress.weeklyGoal")} value={72}>
              {formatNumber(0.72, { style: "percent" })}
            </ProgressRing>
            <ProgressRing
              label={t("progress.level")}
              value={32}
              tone="gold"
              size={72}
              strokeWidth={6}
            >
              <span className="text-sm">{formatNumber(0.32, { style: "percent" })}</span>
            </ProgressRing>
          </div>
        </GlowCard>
      </Section>

      <Section title={t("sections.pills")}>
        <div className="flex flex-wrap gap-2">
          <StatusPill>{t("pills.draft")}</StatusPill>
          <StatusPill tone="violet">{t("pills.active")}</StatusPill>
          <StatusPill tone="teal" dot>
            {t("pills.live")}
          </StatusPill>
          <StatusPill tone="gold">
            <SparklesIcon />
            {t("pills.reward", { xp: formatNumber(50) })}
          </StatusPill>
          <StatusPill tone="green">{t("pills.won")}</StatusPill>
          <StatusPill tone="pink">{t("pills.lost")}</StatusPill>
        </div>
      </Section>

      <Section title={t("sections.buttons")}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t("buttons.primary")}</Button>
          <Button variant="outline">{t("buttons.secondary")}</Button>
          <Button variant="ghost">{t("buttons.ghost")}</Button>
          <Button variant="destructive">{t("buttons.destructive")}</Button>
          <Button variant="link">{t("buttons.link")}</Button>
          <Button disabled>{t("buttons.disabled")}</Button>
        </div>
      </Section>

      <Section title={t("sections.controls")}>
        <GlowCard interactive={false} className="grid gap-5 md:grid-cols-2">
          <Field id="ds-name" label={t("controls.name")}>
            <Input id="ds-name" placeholder={t("controls.namePlaceholder")} />
          </Field>
          <Field id="ds-invalid" label={t("controls.invalid")} hint={t("controls.invalidHint")}>
            <Input id="ds-invalid" aria-invalid defaultValue={t("controls.invalidValue")} />
          </Field>
          <Field id="ds-stage" label={t("controls.stage")}>
            <Select
              value={stage}
              onValueChange={setStage}
              items={stages.map((s) => ({ value: s, label: t(`controls.stages.${s}`) }))}
            >
              <SelectTrigger id="ds-stage">
                <SelectValue placeholder={t("controls.stagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`controls.stages.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="ds-date" label={t("controls.date")}>
            <DatePicker
              id="ds-date"
              value={date}
              onValueChange={setDate}
              placeholder={t("controls.datePlaceholder")}
            />
          </Field>
          <Field id="ds-notes" label={t("controls.notes")} className="md:col-span-2">
            <Textarea id="ds-notes" placeholder={t("controls.notesPlaceholder")} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
            <span className="text-sm text-ink-soft">{t("controls.notifications")}</span>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <Checkbox checked={done} onCheckedChange={setDone} />
            <span className={cn("text-sm", done ? "text-ink-muted line-through" : "text-ink-soft")}>
              {t("controls.task")}
            </span>
          </label>
          <Field id="ds-native" label={t("controls.nativeFallback")} className="md:col-span-2">
            {/* No native date input: it formats dates by browser locale, not user settings. */}
            <select id="ds-native" defaultValue="lead">
              {stages.map((s) => (
                <option key={s} value={s}>
                  {t(`controls.stages.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </GlowCard>
      </Section>

      <Section title={t("sections.empty")}>
        <EmptyState
          icon={<InboxIcon />}
          title={t("empty.title")}
          description={t("empty.description")}
          action={<Button>{t("empty.action")}</Button>}
        />
      </Section>

      <Section title={t("sections.jarvis")}>
        <GlowCard interactive={false} className="flex flex-wrap items-end justify-around gap-8">
          {jarvisStates.map((state) => (
            <div key={state} className="flex flex-col items-center gap-3">
              <div className="flex items-end gap-4">
                <JarvisBot state={state} size={96} />
                <JarvisBot state={state} size={40} />
                <JarvisBot state={state} size={24} />
              </div>
              <span className="micro-label">{t(`jarvis.${state}`)}</span>
            </div>
          ))}
        </GlowCard>
      </Section>

      <Section title={t("sections.skeleton")}>
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <GlowCard key={i} interactive={false} className="flex flex-col gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-2.5 w-full rounded-full" />
            </GlowCard>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex min-h-10 items-center justify-between gap-4">
        <h2 className="micro-label">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-pink">{hint}</p>}
    </div>
  );
}

function ProgressRow({
  label,
  value,
  children,
}: {
  label: string;
  value: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="font-semibold text-ink tabular-nums">
          {formatNumber(value, { style: "percent" })}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Colour swatch that reads the live token value, so the page checks the CSS, not a copy of it. */
function Swatch({ token, swatch, role }: { token: string; swatch: string; role: string }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(
      getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim(),
    );
  }, [token]);

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("h-16 rounded-xl border border-line", swatch)} />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{role}</span>
        <code className="truncate text-xs text-ink-muted">--color-{token}</code>
        <code className="text-xs text-ink-muted uppercase">{value}</code>
      </div>
    </div>
  );
}
