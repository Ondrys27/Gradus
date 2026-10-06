"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, toSiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { RevealGroup, RevealItem } from "./reveal";
import { SectionHeading } from "./section";

export const FAQ_ITEMS = ["card", "cancel", "mobile", "game", "ai", "notFor", "contacts"] as const;

/** 9. Questions people ask before they try it; one open at a time. */
export function Faq() {
  const t = useTranslations("marketing.home.faq");
  const locale = toSiteLocale(useLocale());
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();

  return (
    <section
      id={homeAnchorId(locale, "faq")}
      aria-labelledby="faq-title"
      className="mx-auto w-full max-w-3xl scroll-mt-24 px-4 py-24 md:px-8 md:py-36"
    >
      <SectionHeading id="faq-title" title={t("title")} />
      <RevealGroup stagger={0.05} className="mt-14 flex flex-col gap-3">
        {FAQ_ITEMS.map((item) => {
          const isOpen = open === item;
          const panelId = `${baseId}-${item}`;
          return (
            <RevealItem
              key={item}
              className={cn(
                "rounded-card border bg-surface/80 transition-colors duration-300",
                isOpen ? "border-line-strong" : "border-line",
              )}
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : item)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-card px-5 py-4 text-left text-lg font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex-1">
                    {t(`items.${item}.question`, { appName: APP_NAME })}
                  </span>
                  <motion.span
                    aria-hidden
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.25 }}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-violet/15 text-violet"
                  >
                    <PlusIcon className="size-4" />
                  </motion.span>
                </button>
              </h3>
              {/* Always in the page (search engines, find in page); hidden while closed. */}
              <motion.div
                id={panelId}
                hidden={!isOpen}
                initial={false}
                animate={isOpen ? { opacity: 1, y: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="px-5 pb-5 text-ink-soft">
                  {t(`items.${item}.answer`, { appName: APP_NAME })}
                </p>
              </motion.div>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}
