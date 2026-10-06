import { ArrowDownIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { SignupCta } from "../signup-cta";
import { HeroTilt } from "./scroll-effects";
import { Screenshot } from "./screenshot";
import { WordReveal, wordRevealEnd } from "./word-reveal";

const SUBTITLE_STAGGER = 0.022;

/** 1. The promise, the main button and the app itself right under it. */
export async function Hero({
  locale,
  signupEnabled,
}: {
  locale: SiteLocale;
  signupEnabled: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "marketing" });
  const title = t("home.hero.title");
  const subtitle = t("home.hero.subtitle", { appName: APP_NAME });
  const subtitleStart = wordRevealEnd(title) + 0.1;
  const actionsDelay = `${(wordRevealEnd(subtitle, subtitleStart, SUBTITLE_STAGGER) + 0.1).toFixed(2)}s`;
  const previewId = homeAnchorId(locale, "preview");

  return (
    <section
      aria-labelledby="hero-title"
      className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-14 text-center md:px-8 md:pt-24"
    >
      <p className="mb-6 inline-flex animate-word-in items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-sm text-ink-soft motion-reduce:animate-none">
        <span
          aria-hidden
          className="size-2 rounded-full bg-teal shadow-[0_0_10px_var(--color-teal)]"
        />
        {t("home.hero.badge")}
      </p>
      <h1
        id="hero-title"
        className="max-w-4xl text-[2.6rem] leading-[1.05] font-bold tracking-tight text-balance text-ink sm:text-6xl md:text-7xl"
      >
        <WordReveal text={title} />
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-pretty text-ink-soft md:text-xl">
        <WordReveal text={subtitle} startDelay={subtitleStart} stagger={SUBTITLE_STAGGER} />
      </p>

      <div
        className="mt-10 flex animate-word-in flex-col items-center gap-3 motion-reduce:animate-none"
        style={{ animationDelay: actionsDelay }}
      >
        <SignupCta
          signupEnabled={signupEnabled}
          source="hero"
          long
          size="lg"
          className="h-13 px-7"
        />
        <p className="text-sm text-ink-muted">
          {signupEnabled ? t("cta.noCard") : t("cta.waitlistNote", { appName: APP_NAME })}
        </p>
        <a
          href={`#${previewId}`}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("home.hero.secondary")}
          <ArrowDownIcon aria-hidden className="size-4" />
        </a>
      </div>

      <div id={previewId} className="relative mt-14 w-full scroll-mt-24 md:mt-20">
        {/* A soft violet light behind the window. */}
        <div
          aria-hidden
          className="absolute inset-x-[10%] top-[8%] bottom-0 -z-10 rounded-full bg-violet/40 blur-[90px]"
        />
        <HeroTilt>
          <Screenshot
            name="dashboard"
            mobileName="dashboard-mobile"
            alt={t("home.hero.previewAlt", { appName: APP_NAME })}
            priority
            sizes="(min-width: 1152px) 1088px, 100vw"
          />
        </HeroTilt>
      </div>
    </section>
  );
}
