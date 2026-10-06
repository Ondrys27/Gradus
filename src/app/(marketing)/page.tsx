import type { Metadata } from "next";
import {
  BotIcon,
  CalendarDaysIcon,
  ContactRoundIcon,
  MilestoneIcon,
  SquareKanbanIcon,
  WalletIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { GlowCard } from "@/components/ui/glow-card";
import { SignupCta } from "@/features/marketing/signup-cta";
import { APP_NAME } from "@/lib/constants";
import { HOME_ANCHORS, toSiteLocale } from "@/lib/routes";
import { isPublicSignupEnabled } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return {
    title: { absolute: t("homeTitle", { appName: APP_NAME }) },
    description: t("homeDescription", { appName: APP_NAME }),
  };
}

const FEATURES = [
  { key: "milestones", icon: MilestoneIcon },
  { key: "pipeline", icon: SquareKanbanIcon },
  { key: "contacts", icon: ContactRoundIcon },
  { key: "calendar", icon: CalendarDaysIcon },
  { key: "finance", icon: WalletIcon },
  { key: "jarvis", icon: BotIcon },
] as const;

/** The home page. Its full design and texts come in the next step (prompt 10.2). */
export default async function HomePage() {
  const [t, locale] = await Promise.all([getTranslations("marketing"), getLocale()]);
  const signupEnabled = isPublicSignupEnabled();

  return (
    <>
      <section className="flex flex-col items-center gap-6 py-20 text-center md:py-28">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance text-ink md:text-6xl">
          {t("home.title")}
        </h1>
        <p className="max-w-2xl text-lg text-pretty text-ink-soft">
          {t("home.subtitle", { appName: APP_NAME })}
        </p>
        <div className="flex flex-col items-center gap-3">
          <SignupCta signupEnabled={signupEnabled} source="hero" long size="lg" />
          {signupEnabled && <p className="text-sm text-ink-muted">{t("cta.noCard")}</p>}
        </div>
      </section>

      <section
        id={HOME_ANCHORS.features[toSiteLocale(locale)]}
        className="flex scroll-mt-24 flex-col gap-8 pb-24"
      >
        <h2 className="text-center text-2xl font-semibold text-ink md:text-3xl">
          {t("home.featuresTitle")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <GlowCard interactive={false} className="flex items-center gap-4">
                <Icon aria-hidden className="size-6 text-teal" />
                <span className="font-medium text-ink">{t(`home.features.${key}`)}</span>
              </GlowCard>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
