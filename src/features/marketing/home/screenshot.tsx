import Image from "next/image";
import { cn } from "@/lib/utils";
import { PreviewMock } from "./preview-mock";
import {
  mobileScreenshotSrc,
  screenshotSrc,
  MOBILE_SCREENSHOT_HEIGHT,
  MOBILE_SCREENSHOT_WIDTH,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
  type MobileScreenshotName,
  type ScreenshotName,
} from "./screenshots";

const chrome = (
  <div aria-hidden className="flex h-7 items-center gap-1.5 border-b border-line/60 px-3 md:h-9">
    <span className="size-2.5 rounded-full bg-pink/70" />
    <span className="size-2.5 rounded-full bg-gold/70" />
    <span className="size-2.5 rounded-full bg-green/70" />
  </div>
);

/**
 * A screenshot of the app in a window frame: the real image once
 * /public/screenshots has it, a drawn stand-in of the same size until then.
 * With `mobileName`, phones get their own, taller shot instead of a scaled
 * down desktop one (the hero and the Cold Calling feature use this).
 */
export function Screenshot({
  name,
  mobileName,
  alt,
  priority = false,
  sizes,
  className,
}: {
  name: ScreenshotName;
  mobileName?: MobileScreenshotName;
  alt: string;
  /** The hero image: loaded first, it is the largest thing on screen. */
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const src = screenshotSrc(name);
  const frameClass = cn(
    "overflow-hidden rounded-2xl border border-line-strong/70 bg-surface shadow-glow-strong",
    className,
  );

  if (!mobileName) {
    return (
      <div className={frameClass}>
        {chrome}
        {src ? (
          <Image
            src={src}
            alt={alt}
            width={SCREENSHOT_WIDTH}
            height={SCREENSHOT_HEIGHT}
            sizes={sizes}
            priority={priority}
            className="block h-auto w-full"
          />
        ) : (
          <PreviewMock name={name} label={alt} />
        )}
      </div>
    );
  }

  const mobileSrc = mobileScreenshotSrc(mobileName);
  return (
    <>
      <div className={cn(frameClass, "hidden md:block")}>
        {chrome}
        {src ? (
          <Image
            src={src}
            alt={alt}
            width={SCREENSHOT_WIDTH}
            height={SCREENSHOT_HEIGHT}
            sizes={sizes}
            priority={priority}
            className="block h-auto w-full"
          />
        ) : (
          <PreviewMock name={name} label={alt} />
        )}
      </div>
      <div className={cn(frameClass, "mx-auto block w-[min(78vw,320px)] md:hidden")}>
        {chrome}
        {mobileSrc ? (
          <Image
            src={mobileSrc}
            alt={alt}
            width={MOBILE_SCREENSHOT_WIDTH}
            height={MOBILE_SCREENSHOT_HEIGHT}
            sizes="78vw"
            priority={priority}
            className="block h-auto w-full"
          />
        ) : (
          <PreviewMock name={name} label={alt} />
        )}
      </div>
    </>
  );
}
