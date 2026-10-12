import { ArrowDownIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { SignupCta } from "../signup-cta";
import { NoteList, NotesOverlay, type Note } from "./notes";
import { HeroTilt } from "./scroll-effects";
import { Screenshot } from "./screenshot";

/**
 * 1. The promise, one honest sentence about the problem, the button, and the
 * app itself leaning back under it. The screenshot runs past the text column
 * on the right on purpose; the only light on the page sits behind it.
 */
export async function Hero({
  locale,
  signupEnabled,
}: {
  locale: SiteLocale;
  signupEnabled: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "marketing.home.hero" });
  const tCta = await getTranslations({ locale, namespace: "marketing.cta" });
  const previewId = homeAnchorId(locale, "preview");
  const notes: readonly Note[] = [
    { text: t("notes.stalled"), at: [80, 42.5], label: [58, 70], align: "end", tilt: -2 },
    { text: t("notes.streak"), at: [80.5, 4], label: [60, 11], align: "end", tilt: 1.5 },
  ];

  return (
    <section
      aria-labelledby="hero-title"
      className="relative mx-auto w-full max-w-6xl px-4 pt-8 md:px-8 md:pt-16"
    >
      <div className="max-w-[54rem]">
        <h1
          id="hero-title"
          className="font-display text-[2.9rem] leading-[0.96] font-semibold tracking-[-0.035em] text-ink sm:text-6xl md:text-[5.4rem]"
        >
          {t("title")}
        </h1>
        <p className="mt-7 max-w-[40rem] text-lg leading-relaxed text-ink-soft md:mt-9 md:text-xl">
          {t("problem")} {t("promise", { appName: APP_NAME })}
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <SignupCta
            signupEnabled={signupEnabled}
            source="hero"
            long
            size="lg"
            className="h-13 px-7"
          />
          <p className="text-sm text-ink-muted">
            {signupEnabled ? tCta("noCard") : tCta("waitlistNote", { appName: APP_NAME })}
          </p>
        </div>
        <a
          href={`#${previewId}`}
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("secondary")}
          <ArrowDownIcon aria-hidden className="size-4" />
        </a>
      </div>

      <div
        id={previewId}
        className="relative mt-12 scroll-mt-24 md:mt-16 md:-mr-[10%] lg:-mr-[18%] xl:-mr-[24%]"
      >
        {/* The one light on the website: a violet glow behind the leaning window. */}
        <div
          aria-hidden
          className="absolute inset-x-[12%] top-[10%] bottom-[6%] -z-10 rounded-full bg-violet/35 blur-[90px]"
        />
        <HeroTilt>
          <Screenshot
            name="dashboard"
            mobileName="dashboard-mobile"
            alt={t("previewAlt", { appName: APP_NAME })}
            priority
            sizes="(min-width: 1280px) 1420px, (min-width: 768px) 110vw, 100vw"
            overlay={<NotesOverlay notes={notes} />}
          />
        </HeroTilt>
        <NoteList notes={notes} className="mx-auto mt-5 w-[min(78vw,320px)] md:hidden" />
      </div>
    </section>
  );
}
