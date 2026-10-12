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

const frameClass =
  "overflow-hidden rounded-xl border border-line-strong/60 bg-surface shadow-popover md:rounded-2xl";

/**
 * A screenshot of the app, plainly framed: a thin line and a deep shadow,
 * no drawn window around it. The real image once /public/screenshots has
 * it, a drawn stand-in of the same size until then. With `mobileName`,
 * phones get their own, taller shot instead of a scaled down desktop one.
 * `overlay` is drawn over the desktop shot only (the notes point at its details).
 */
export function Screenshot({
  name,
  mobileName,
  alt,
  priority = false,
  sizes,
  className,
  overlay,
}: {
  name: ScreenshotName;
  mobileName?: MobileScreenshotName;
  alt: string;
  /** The hero image: loaded first, it is the largest thing on screen. */
  priority?: boolean;
  sizes: string;
  className?: string;
  overlay?: React.ReactNode;
}) {
  const src = screenshotSrc(name);
  const desktop = (
    <div className={cn("relative", frameClass, mobileName && "hidden md:block", className)}>
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
      {overlay}
    </div>
  );

  if (!mobileName) return desktop;

  const mobileSrc = mobileScreenshotSrc(mobileName);
  return (
    <>
      {desktop}
      <div className={cn(frameClass, "mx-auto block w-[min(78vw,320px)] md:hidden", className)}>
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
