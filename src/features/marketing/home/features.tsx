import {
  BotIcon,
  CalendarDaysIcon,
  PhoneCallIcon,
  RouteIcon,
  SquareKanbanIcon,
  WalletIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { DriftIntoFocus } from "./scroll-effects";
import { Screenshot } from "./screenshot";
import type { ScreenshotName } from "./screenshots";
import { Section, SectionHeading } from "./section";

const FEATURES = [
  { key: "milestones", icon: RouteIcon, shot: "milestones", tone: "text-violet bg-violet/12" },
  { key: "pipeline", icon: SquareKanbanIcon, shot: "pipeline", tone: "text-green bg-green/12" },
  { key: "contacts", icon: PhoneCallIcon, shot: "cold-calling", tone: "text-teal bg-teal/12" },
  { key: "calendar", icon: CalendarDaysIcon, shot: "calendar", tone: "text-gold bg-gold/12" },
  { key: "finance", icon: WalletIcon, shot: "finance", tone: "text-orange bg-orange/12" },
  { key: "jarvis", icon: BotIcon, shot: "jarvis", tone: "text-teal bg-teal/12" },
] as const satisfies readonly { key: string; icon: unknown; shot: ScreenshotName; tone: string }[];

/** 3. Six features, text and screenshot side by side, alternating. */
export async function Features({ locale }: { locale: SiteLocale }) {
  const t = await getTranslations({ locale, namespace: "marketing.home.features" });
  return (
    <Section id={homeAnchorId(locale, "features")} labelledBy="features-title">
      <SectionHeading id="features-title" title={t("title")} subtitle={t("subtitle")} />
      <ul className="mt-20 flex flex-col gap-24 md:mt-28 md:gap-36">
        {FEATURES.map(({ key, icon: Icon, shot, tone }, index) => (
          <li
            key={key}
            className={cn(
              "grid items-center gap-10 md:gap-16",
              index % 2 === 0 ? "md:grid-cols-[5fr_7fr]" : "md:grid-cols-[7fr_5fr]",
            )}
          >
            <Reveal className={cn("flex flex-col gap-4", index % 2 === 1 && "md:order-2")}>
              <span className={cn("grid size-12 place-items-center rounded-xl", tone)}>
                <Icon aria-hidden className="size-6" />
              </span>
              <h3 className="text-3xl font-bold tracking-tight text-balance text-ink md:text-4xl">
                {t(`items.${key}.title`)}
              </h3>
              <p className="text-lg text-pretty text-ink-soft">
                {t(`items.${key}.text`, { appName: APP_NAME })}
              </p>
            </Reveal>
            <DriftIntoFocus className={cn(index % 2 === 1 && "md:order-1")}>
              <Screenshot
                name={shot}
                alt={t(`items.${key}.alt`, { appName: APP_NAME })}
                sizes="(min-width: 1152px) 620px, (min-width: 768px) 56vw, 100vw"
              />
            </DriftIntoFocus>
          </li>
        ))}
      </ul>
    </Section>
  );
}
