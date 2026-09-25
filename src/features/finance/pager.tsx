"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";

type Props = { page: number; pages: number; onPage: (page: number) => void };

const buttonClass =
  "grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-not-allowed disabled:opacity-30 mouse:size-8";

/** Nothing when everything fits on one page. */
export function Pager({ page, pages, onPage }: Props) {
  const t = useTranslations("finance.pager");
  const settings = useFormatSettings();
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("label")} className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label={t("previous")}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className={buttonClass}
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
      </button>
      <span className="text-sm text-ink-soft tabular-nums" aria-live="polite">
        {t("position", {
          page: formatNumber(page + 1, {}, settings),
          pages: formatNumber(pages, {}, settings),
        })}
      </span>
      <button
        type="button"
        aria-label={t("next")}
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
        className={buttonClass}
      >
        <ChevronRightIcon aria-hidden className="size-4" />
      </button>
    </nav>
  );
}
