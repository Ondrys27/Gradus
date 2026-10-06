"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BriefcaseIcon,
  CodeXmlIcon,
  HammerIcon,
  PaletteIcon,
  PresentationIcon,
  ScissorsIcon,
  ShoppingCartIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  AUDIENCE_PATH,
  AUDIENCE_TILES,
  FIRST_CHAPTER_STEPS,
  type AudienceTile,
} from "./audience-paths";
import { RevealGroup, RevealItem } from "./reveal";
import { SectionHeading } from "./section";

const ICONS: Record<AudienceTile, LucideIcon> = {
  craftsman: HammerIcon,
  consultant: PresentationIcon,
  ecommerce: ShoppingCartIcon,
  gastro: UtensilsIcon,
  personalServices: ScissorsIcon,
  creative: PaletteIcon,
  it: CodeXmlIcon,
  other: BriefcaseIcon,
};

/**
 * 7. Eight fields. Pointing at a tile (or tapping it on a phone, or pressing
 * it from the keyboard) turns it over to the first chapter of that field's path.
 */
export function Audience() {
  const t = useTranslations("marketing.home.audience");
  const [open, setOpen] = useState<AudienceTile | null>(null);

  return (
    <section
      aria-labelledby="audience-title"
      className="mx-auto w-full max-w-6xl px-4 py-24 md:px-8 md:py-36"
    >
      <SectionHeading
        id="audience-title"
        title={t("title")}
        subtitle={t("subtitle", { appName: APP_NAME })}
      />
      <RevealGroup stagger={0.06} className="mt-16 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {AUDIENCE_TILES.map((tile) => {
          const Icon = ICONS[tile];
          const path = AUDIENCE_PATH[tile];
          const isOpen = open === tile;
          return (
            <RevealItem key={tile}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={(event) => {
                  // A mouse already opened it on hover; a tap or a key toggles it.
                  const pointer = (event.nativeEvent as PointerEvent).pointerType;
                  setOpen(pointer === "mouse" || !isOpen ? tile : null);
                }}
                onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(tile)}
                onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(null)}
                onBlur={() => setOpen((current) => (current === tile ? null : current))}
                className={cn(
                  "relative grid min-h-48 w-full cursor-pointer overflow-hidden rounded-card border bg-surface/80 p-4 text-left shadow-glow outline-none transition-[border-color,background-color] duration-300 focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-56 md:p-5",
                  isOpen ? "border-violet/70 bg-surface" : "border-line",
                )}
              >
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.span
                      key="chapter"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.25 }}
                      className="col-start-1 row-start-1 flex flex-col gap-2"
                    >
                      <span className="micro-label text-teal">
                        {t("firstChapter", { field: t(`tiles.${tile}`) })}
                      </span>
                      <span className="flex flex-col gap-1.5">
                        {FIRST_CHAPTER_STEPS.map((step, index) => (
                          <span key={step} className="flex gap-2 text-sm leading-snug text-ink">
                            <span className="text-ink-muted tabular-nums">{index + 1}.</span>
                            {t(`paths.${path}.${step}`)}
                          </span>
                        ))}
                      </span>
                    </motion.span>
                  ) : (
                    <motion.span
                      key="field"
                      initial={{ opacity: 0, y: -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }}
                      transition={{ duration: 0.25 }}
                      className="col-start-1 row-start-1 flex flex-col justify-between gap-4"
                    >
                      <span className="grid size-12 place-items-center rounded-xl bg-violet/12 text-violet">
                        <Icon aria-hidden className="size-6" />
                      </span>
                      <span className="flex flex-col gap-1">
                        <span className="text-lg font-semibold text-ink">{t(`tiles.${tile}`)}</span>
                        <span className="text-sm text-ink-muted">{t("hint")}</span>
                      </span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}
