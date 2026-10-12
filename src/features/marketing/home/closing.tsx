import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { founderName } from "../founder";
import { SignupCta } from "../signup-cta";
import { FaqList } from "./faq";

/**
 * 7. The end of the page in one block: the last call and a note from the
 * founder on the left, the questions people ask before they try it on the
 * right. No photo until /public/founders.jpg exists; nothing is made up.
 */
export async function Closing({
  locale,
  signupEnabled,
}: {
  locale: SiteLocale;
  signupEnabled: boolean;
}) {
  const [t, tFaq, name] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.home.final" }),
    getTranslations({ locale, namespace: "marketing.home.faq" }),
    founderName(),
  ]);

  return (
    <section
      id={homeAnchorId(locale, "faq")}
      aria-labelledby="final-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pt-28 pb-24 md:px-8 md:pt-44 md:pb-36"
    >
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-8 lg:col-span-5">
          <h2
            id="final-title"
            className="font-display text-5xl leading-[0.95] font-semibold tracking-[-0.035em] text-balance text-ink md:text-6xl"
          >
            {signupEnabled ? t("title") : t("titleWaitlist", { appName: APP_NAME })}
          </h2>
          <div className="flex flex-col items-start gap-3">
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

          <figure className="mt-6 flex max-w-[30rem] flex-col gap-4 border-l-2 border-violet pl-5">
            <p className="text-sm text-ink-muted">{t("founderLabel")}</p>
            <blockquote className="leading-relaxed text-ink-soft">
              {t("founderNote", { appName: APP_NAME })}
            </blockquote>
            <figcaption className="font-hand text-2xl text-ink">
              {name ? t("signature", { name }) : t("signatureRole", { appName: APP_NAME })}
            </figcaption>
          </figure>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-6 lg:col-start-7">
          <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
            {tFaq("title")}
          </h3>
          <FaqList questionTag="h4" />
        </div>
      </div>
    </section>
  );
}
