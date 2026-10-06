import Image from "next/image";
import { cn } from "@/lib/utils";
import { PreviewMock } from "./preview-mock";
import {
  screenshotSrc,
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
  type ScreenshotName,
} from "./screenshots";

/**
 * A screenshot of the app in a window frame: the real image once
 * /public/screenshots has it, a drawn stand-in of the same size until then.
 */
export function Screenshot({
  name,
  alt,
  priority = false,
  sizes,
  className,
}: {
  name: ScreenshotName;
  alt: string;
  /** The hero image: loaded first, it is the largest thing on screen. */
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const src = screenshotSrc(name);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-line-strong/70 bg-surface shadow-glow-strong",
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-7 items-center gap-1.5 border-b border-line/60 px-3 md:h-9"
      >
        <span className="size-2.5 rounded-full bg-pink/70" />
        <span className="size-2.5 rounded-full bg-gold/70" />
        <span className="size-2.5 rounded-full bg-green/70" />
      </div>
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
