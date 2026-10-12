"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, toSiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const FAQ_ITEMS = ["card", "cancel", "mobile", "game", "ai", "notFor", "contacts"] as const;

/** The questions as a plain list with rules between them; one open at a time. */
export function FaqList({
  className,
  questionTag: Question = "h3",
}: {
  className?: string;
  /** One level under the heading the caller puts above the list. */
  questionTag?: "h3" | "h4";
}) {
  const t = useTranslations("marketing.home.faq");
  const [open, setOpen] = useState<string | null>(null);
  const baseId = useId();

  return (
    <ul className={cn("flex flex-col border-t border-line", className)}>
      {FAQ_ITEMS.map((item) => {
        const isOpen = open === item;
        const panelId = `${baseId}-${item}`;
        return (
          <li key={item} className="border-b border-line">
            <Question>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : item)}
                className="flex min-h-14 w-full cursor-pointer items-center gap-4 py-4 text-left text-lg font-medium text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex-1">{t(`items.${item}.question`, { appName: APP_NAME })}</span>
                <motion.span
                  aria-hidden
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="grid size-8 shrink-0 place-items-center text-violet"
                >
                  <PlusIcon className="size-5" />
                </motion.span>
              </button>
            </Question>
            {/* Always in the page (search engines, find in page); hidden while closed. */}
            <div id={panelId} hidden={!isOpen}>
              <p className="max-w-[40rem] pb-5 leading-relaxed text-ink-soft">
                {t(`items.${item}.answer`, { appName: APP_NAME })}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The questions as their own section, for the /cenik page. */
export function Faq() {
  const t = useTranslations("marketing.home.faq");
  const locale = toSiteLocale(useLocale());
  return (
    <section
      id={homeAnchorId(locale, "faq")}
      aria-labelledby="faq-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-28 md:px-8 md:py-40"
    >
      <div className="grid gap-8 md:grid-cols-12">
        <h2
          id="faq-title"
          className="font-display text-4xl leading-[1] font-semibold tracking-[-0.03em] text-ink md:col-span-4 md:text-5xl"
        >
          {t("title")}
        </h2>
        <FaqList className="md:col-span-7 md:col-start-6" />
      </div>
    </section>
  );
}
