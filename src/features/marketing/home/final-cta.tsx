import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import type { SiteLocale } from "@/lib/routes";
import { SignupCta } from "../signup-cta";
import { founderName } from "../founder";
import { Reveal } from "./reveal";

/** 10. The last call, and an honest word from the founder. */
export async function FinalCta({
  locale,
  signupEnabled,
}: {
  locale: SiteLocale;
  signupEnabled: boolean;
}) {
  const [t, name] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.home.final" }),
    founderName(),
  ]);
  return (
    <section
      aria-labelledby="final-title"
      className="relative mx-auto w-full max-w-6xl px-4 py-24 md:px-8 md:py-40"
    >
      <div
        aria-hidden
        className="absolute inset-x-[15%] top-1/4 -z-10 h-1/2 rounded-full bg-violet/30 blur-[110px]"
      />
      <Reveal className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <h2
          id="final-title"
          className="text-5xl font-bold tracking-tight text-balance text-ink md:text-7xl"
        >
          {signupEnabled ? t("title") : t("titleWaitlist", { appName: APP_NAME })}
        </h2>
        <div className="flex flex-col items-center gap-3">
          <SignupCta
            signupEnabled={signupEnabled}
            source="final"
            long
            size="lg"
            className="h-13 px-7"
          />
          <p className="text-sm text-ink-muted">
            {signupEnabled ? t("note") : t("noteWaitlist", { appName: APP_NAME })}
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mx-auto mt-20 max-w-2xl">
        <figure className="flex flex-col gap-5 rounded-card border border-line bg-surface/70 p-6 md:p-8">
          <p className="micro-label">{t("founderLabel")}</p>
          <blockquote className="text-lg leading-relaxed text-pretty text-ink-soft">
            {t("founderNote", { appName: APP_NAME })}
          </blockquote>
          <figcaption className="font-semibold text-ink">
            {name ? t("signature", { name }) : t("signatureRole", { appName: APP_NAME })}
          </figcaption>
        </figure>
      </Reveal>
    </section>
  );
}
