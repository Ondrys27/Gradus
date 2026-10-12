import { getTranslations } from "next-intl/server";
import { APP_NAME } from "@/lib/constants";
import { homeAnchorId, type SiteLocale } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { JarvisChat } from "./jarvis-chat";
import { NoteList, NotesOverlay, type Note } from "./notes";
import { Screenshot } from "./screenshot";
import type { MobileScreenshotName, ScreenshotName } from "./screenshots";

type Story = {
  key: "pipeline" | "calling" | "jarvis";
  shot: ScreenshotName;
  mobileShot?: MobileScreenshotName;
  /** Which side the words sit on; the picture takes the whole width under them. */
  side: "left" | "right";
  notes: readonly Omit<Note, "text">[];
};

const STORIES: readonly Story[] = [
  {
    key: "pipeline",
    shot: "pipeline",
    mobileShot: "pipeline-mobile",
    side: "left",
    notes: [
      { at: [88, 36.5], label: [64, 72], align: "start", tilt: -2 },
      { at: [48, 44], label: [36, 80], align: "start", tilt: 1.5 },
    ],
  },
  {
    key: "calling",
    shot: "cold-calling",
    mobileShot: "cold-calling-mobile",
    side: "right",
    notes: [
      { at: [72, 39.5], label: [40, 84], align: "start", tilt: -1.5 },
      { at: [40, 36.5], label: [49, 23.5], align: "start", tilt: 2 },
    ],
  },
  {
    key: "jarvis",
    shot: "jarvis",
    side: "left",
    notes: [
      { at: [73.5, 28.5], label: [44, 72], align: "start", tilt: -2 },
      { at: [74.5, 53.5], label: [46, 85], align: "start", tilt: 1.5 },
    ],
  },
];

/**
 * 2–4. Three things the app does, told one at a time: a few sentences on one
 * side, the real screen across the whole width with handwritten notes at the
 * details that matter. Jarvis's story ends with a chat that plays itself.
 */
export async function Stories({ locale }: { locale: SiteLocale }) {
  const t = await getTranslations({ locale, namespace: "marketing.home.stories" });
  return (
    <section
      id={homeAnchorId(locale, "features")}
      aria-label={t("label", { appName: APP_NAME })}
      className="mx-auto mt-28 flex w-full max-w-6xl scroll-mt-24 flex-col gap-28 px-4 md:mt-44 md:gap-40 md:px-8"
    >
      {STORIES.map((story) => {
        const notes: readonly Note[] = story.notes.map((note, i) => ({
          ...note,
          text: t(`${story.key}.notes.${i + 1}`, { appName: APP_NAME }),
        }));
        const right = story.side === "right";
        return (
          <article
            key={story.key}
            aria-labelledby={`story-${story.key}`}
            className={cn(
              "grid gap-8 md:gap-10 lg:grid-cols-12",
              // Room for the chat that hangs below the last picture.
              story.key === "jarvis" && "lg:pb-24",
            )}
          >
            <div
              className={cn(
                "flex flex-col gap-5 lg:col-span-6",
                right ? "lg:col-start-7" : "lg:col-start-1",
              )}
            >
              <h2
                id={`story-${story.key}`}
                className="font-display text-[2.35rem] leading-[1] font-semibold tracking-[-0.03em] text-balance text-ink md:text-5xl"
              >
                {t(`${story.key}.title`)}
              </h2>
              <p className="max-w-[36rem] text-lg leading-relaxed text-ink-soft">
                {t(`${story.key}.text`, { appName: APP_NAME })}
              </p>
            </div>

            <div
              className={cn(
                "relative lg:col-span-12",
                // The picture runs a little past the grid on the side the words are not on.
                right ? "md:-ml-[6%] lg:-ml-[10%]" : "md:-mr-[6%] lg:-mr-[10%]",
              )}
            >
              <Screenshot
                name={story.shot}
                mobileName={story.mobileShot}
                alt={t(`${story.key}.alt`, { appName: APP_NAME })}
                sizes="(min-width: 1152px) 1270px, 100vw"
                overlay={<NotesOverlay notes={notes} />}
              />
              <NoteList
                notes={notes}
                className={cn("mt-4 md:hidden", story.mobileShot && "mx-auto w-[min(78vw,320px)]")}
              />
              {story.key === "jarvis" && (
                <JarvisChat className="mt-8 w-full max-w-[27rem] lg:absolute lg:-bottom-24 lg:left-[4%] lg:mt-0" />
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
