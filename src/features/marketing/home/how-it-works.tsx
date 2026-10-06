import { ToggleRightIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { Reveal, RevealGroup, RevealItem } from "./reveal";
import { Section, SectionHeading } from "./section";

const STEPS = ["pick", "work", "unlock"] as const;

/** 4. Three steps, numbered, short. */
export async function HowItWorks({ locale }: { locale: SiteLocale }) {
  const t = await getTranslations({ locale, namespace: "marketing.home.how" });
  return (
    <Section id={homeAnchorId(locale, "howItWorks")} labelledBy="how-title">
      <SectionHeading id="how-title" title={t("title")} />
      <div className="relative mt-16">
        {/* The line the three numbers sit on. */}
        <div
          aria-hidden
          className="absolute top-7 right-[16%] left-[16%] hidden h-px bg-linear-to-r from-violet via-teal to-gold opacity-50 md:block"
        />
        <RevealGroup as="ol" stagger={0.15} className="grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, index) => (
            <RevealItem
              key={step}
              className="relative flex flex-col items-center gap-4 text-center"
            >
              <span className="grid size-14 place-items-center rounded-full border border-line-strong bg-canvas text-xl font-bold text-ink shadow-glow-strong">
                {index + 1}
              </span>
              <h3 className="text-2xl font-semibold text-ink">{t(`steps.${step}.title`)}</h3>
              <p className="max-w-xs text-ink-soft">
                {t(`steps.${step}.text`, { appName: APP_NAME })}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
      <Reveal className="mt-16 flex justify-center">
        <p className="inline-flex items-center gap-3 rounded-full border border-line bg-surface/70 px-5 py-3 text-center text-ink-soft">
          <ToggleRightIcon aria-hidden className="size-5 shrink-0 text-teal" />
          {t("toolMode", { appName: APP_NAME })}
        </p>
      </Reveal>
    </Section>
  );
}
