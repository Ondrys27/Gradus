import { BatteryLowIcon, CalendarClockIcon, CompassIcon, SheetIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "@/lib/routes";
import { RevealGroup, RevealItem } from "./reveal";
import { Section, SectionHeading } from "./section";

const PAINS = [
  { key: "spreadsheets", icon: SheetIcon, tone: "text-violet bg-violet/12" },
  { key: "followUps", icon: CalendarClockIcon, tone: "text-orange bg-orange/12" },
  { key: "today", icon: CompassIcon, tone: "text-teal bg-teal/12" },
  { key: "motivation", icon: BatteryLowIcon, tone: "text-pink bg-pink/12" },
] as const;

/** 2. The problems a beginner recognises, before any feature. */
export async function Pains({ locale }: { locale: SiteLocale }) {
  const t = await getTranslations({ locale, namespace: "marketing.home.pains" });
  return (
    <Section labelledBy="pains-title">
      <SectionHeading id="pains-title" title={t("title")} />
      <RevealGroup className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PAINS.map(({ key, icon: Icon, tone }) => (
          <RevealItem
            key={key}
            className="flex flex-col gap-4 rounded-card border border-line bg-surface/80 p-6 shadow-glow"
          >
            <span className={`grid size-11 place-items-center rounded-xl ${tone}`}>
              <Icon aria-hidden className="size-5" />
            </span>
            <h3 className="text-lg font-semibold text-ink">{t(`items.${key}.title`)}</h3>
            <p className="text-ink-soft">{t(`items.${key}.text`)}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
