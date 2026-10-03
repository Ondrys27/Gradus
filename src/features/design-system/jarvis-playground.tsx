"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Jarvis,
  JARVIS_DIRECTIONS,
  JARVIS_SIZES,
  JARVIS_STATES,
  type JarvisDirection,
  type JarvisEntrance,
  type JarvisState,
  type JarvisVariant,
} from "@/components/jarvis/jarvis";
import { Button, buttonVariants } from "@/components/ui/button";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";

const SIZES = [JARVIS_SIZES.button, JARVIS_SIZES.bubble, JARVIS_SIZES.stage] as const;
const VARIANTS: JarvisVariant[] = ["full", "head"];
const EDGES: JarvisEntrance[] = ["left", "right", "top", "bottom"];

/** Every Jarvis state and size side by side, with switches for tuning the animation. */
export function JarvisPlayground() {
  const t = useTranslations("designSystem");
  const settings = useFormatSettings();
  const [state, setState] = useState<JarvisState>("idle");
  const [direction, setDirection] = useState<JarvisDirection>("right");
  const [size, setSize] = useState<number>(JARVIS_SIZES.stage);
  const [variant, setVariant] = useState<JarvisVariant>("full");
  const [edge, setEdge] = useState<JarvisEntrance>("right");
  const [present, setPresent] = useState(true);
  const [reduced, setReduced] = useState(false);

  const px = (value: number) => t("jarvisPage.px", { size: formatNumber(value, {}, settings) });

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 md:px-8 md:py-12">
        <PageHeader
          eyebrow={t("eyebrow")}
          title={t("jarvisPage.title")}
          description={t("jarvisPage.description")}
          actions={
            <Link href="/design-system" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("jarvisPage.back")}
            </Link>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <GlowCard
            interactive={false}
            className="relative grid min-h-80 place-items-center overflow-hidden md:min-h-[26rem]"
          >
            <AnimatePresence mode="wait">
              {present && (
                <Jarvis
                  key={`${edge}-${variant}-${size}`}
                  size={size}
                  state={state}
                  direction={direction}
                  variant={variant}
                  enterFrom={edge}
                />
              )}
            </AnimatePresence>
          </GlowCard>

          <GlowCard interactive={false} className="flex flex-col gap-5">
            <Control label={t("jarvisPage.controls.state")}>
              {JARVIS_STATES.map((value) => (
                <Chip key={value} active={state === value} onClick={() => setState(value)}>
                  {t(`jarvis.${value}`)}
                </Chip>
              ))}
            </Control>
            <Control label={t("jarvisPage.controls.direction")}>
              {JARVIS_DIRECTIONS.map((value) => (
                <Chip
                  key={value}
                  active={direction === value}
                  onClick={() => {
                    setDirection(value);
                    setState("pointing");
                  }}
                >
                  {t(`jarvisPage.directions.${value}`)}
                </Chip>
              ))}
            </Control>
            <Control label={t("jarvisPage.controls.size")}>
              {SIZES.map((value) => (
                <Chip key={value} active={size === value} onClick={() => setSize(value)}>
                  {px(value)}
                </Chip>
              ))}
            </Control>
            <Control label={t("jarvisPage.controls.variant")}>
              {VARIANTS.map((value) => (
                <Chip key={value} active={variant === value} onClick={() => setVariant(value)}>
                  {t(`jarvisPage.variants.${value}`)}
                </Chip>
              ))}
            </Control>
            <Control label={t("jarvisPage.controls.entrance")}>
              {EDGES.map((value) => (
                <Chip
                  key={value}
                  active={edge === value}
                  onClick={() => {
                    setEdge(value);
                    setPresent(true);
                  }}
                >
                  {t(`jarvisPage.edges.${value}`)}
                </Chip>
              ))}
              <Button size="sm" onClick={() => setPresent((value) => !value)}>
                {present ? t("jarvisPage.flyOut") : t("jarvisPage.flyIn")}
              </Button>
            </Control>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-ink-soft">{t("jarvisPage.controls.reducedMotion")}</span>
              <Switch checked={reduced} onCheckedChange={setReduced} />
            </label>
          </GlowCard>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="micro-label">{t("jarvisPage.sections.sizes")}</h2>
          <GlowCard
            interactive={false}
            className="flex flex-wrap items-end justify-around gap-x-8 gap-y-6 overflow-hidden"
          >
            {[...SIZES].reverse().map((value) => (
              <Figure key={value} caption={px(value)}>
                <Jarvis size={value} state={state} direction={direction} />
              </Figure>
            ))}
            <Figure caption={`${px(JARVIS_SIZES.button)} · ${t("jarvisPage.variants.head")}`}>
              <Jarvis size={JARVIS_SIZES.button} state={state} direction={direction} variant="head" />
            </Figure>
          </GlowCard>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="micro-label">{t("jarvisPage.sections.states")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {JARVIS_STATES.map((value) => (
              <GlowCard
                key={value}
                interactive={false}
                className="flex flex-col items-center gap-3 overflow-hidden"
              >
                <div className="flex items-end gap-3">
                  <Jarvis size={JARVIS_SIZES.bubble} state={value} direction={direction} />
                  <Jarvis
                    size={JARVIS_SIZES.button}
                    state={value}
                    direction={direction}
                    variant="head"
                  />
                </div>
                <span className="micro-label">{t(`jarvis.${value}`)}</span>
              </GlowCard>
            ))}
          </div>
        </section>
      </div>
    </MotionConfig>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="micro-label">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
      className={active ? "ring-1 ring-teal/60" : undefined}
    >
      {children}
    </Button>
  );
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      {children}
      <figcaption className="text-xs text-ink-muted">{caption}</figcaption>
    </figure>
  );
}
