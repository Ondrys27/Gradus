import { cn } from "@/lib/utils";
import type { ScreenshotName } from "./screenshots";

/**
 * A drawn stand-in for a screenshot, at the screenshot's 16:10 size, until
 * the real images exist. Shapes only, no made-up numbers or names.
 */
export function PreviewMock({ name, label }: { name: ScreenshotName; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex aspect-[16/10] w-full overflow-hidden bg-canvas-deep"
    >
      <div className="hidden w-[15%] flex-col gap-[6%] border-r border-line/60 p-[2%] sm:flex">
        <span className="aspect-square w-1/4 rounded-md bg-linear-to-br from-violet to-teal" />
        {Array.from({ length: 7 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-[3.5%] min-h-1.5 rounded-full",
              i === 1 ? "bg-violet/60" : "bg-line/70",
            )}
            style={{ width: `${60 + ((i * 17) % 30)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-[3%] p-[3%]">
        <div className="flex items-center gap-[2%]">
          <span className="h-[5%] min-h-2 w-[30%] rounded-full bg-ink/70" />
          <span className="ml-auto h-[5%] min-h-2 w-[12%] rounded-full bg-violet/70" />
        </div>
        <div className="flex min-h-0 flex-1">{BODIES[name]}</div>
      </div>
    </div>
  );
}

const tile = "rounded-lg border border-line/70 bg-surface";

function Bars({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-[10%]", className)}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="block h-1.5 rounded-full bg-line"
          style={{ width: `${85 - ((i * 23) % 45)}%` }}
        />
      ))}
    </span>
  );
}

const STAGE_TONES = ["bg-ink-muted", "bg-violet", "bg-orange", "bg-green"] as const;

const BODIES: Record<ScreenshotName, React.ReactNode> = {
  dashboard: (
    <div className="grid w-full grid-cols-4 grid-rows-[1fr_2.4fr] gap-[2%]">
      {["bg-violet", "bg-teal", "bg-gold", "bg-green"].map((tone) => (
        <div key={tone} className={cn(tile, "flex flex-col justify-between p-[6%]")}>
          <span className="h-1.5 w-1/2 rounded-full bg-line" />
          <span className={cn("h-[22%] min-h-2 w-2/3 rounded-full", tone)} />
        </div>
      ))}
      <div className={cn(tile, "col-span-3 flex items-center gap-[4%] p-[4%]")}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="flex flex-1 items-center gap-[8%]">
            <span
              className={cn(
                "aspect-square w-[45%] rounded-full border-2",
                i < 3 ? "border-teal bg-teal/20" : i === 3 ? "border-orange" : "border-line",
              )}
            />
            {i < 5 && <span className={cn("h-0.5 flex-1", i < 3 ? "bg-teal" : "bg-line")} />}
          </span>
        ))}
      </div>
      <div className={cn(tile, "p-[10%]")}>
        <Bars count={5} className="h-full" />
      </div>
    </div>
  ),
  milestones: (
    <div className="grid w-full grid-cols-2 gap-[2.5%]">
      {[100, 100, 60, 0].map((done, i) => (
        <div key={i} className={cn(tile, "flex flex-col justify-between gap-[6%] p-[5%]")}>
          <span className="h-2 w-2/3 rounded-full bg-ink/60" />
          <Bars count={3} />
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <span
              className={cn("block h-full rounded-full", done === 100 ? "bg-teal" : "bg-orange")}
              style={{ width: `${done}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  ),
  pipeline: (
    <div className="grid w-full grid-cols-4 gap-[2%]">
      {STAGE_TONES.map((tone, column) => (
        <div key={tone} className="flex flex-col gap-[4%] rounded-lg bg-surface/50 p-[5%]">
          <span className={cn("h-1 w-full rounded-full", tone)} />
          {Array.from({ length: 3 - (column % 2) }, (_, i) => (
            <span key={i} className={cn(tile, "flex flex-col gap-1.5 p-[8%]")}>
              <span className="h-1.5 w-3/4 rounded-full bg-ink/50" />
              <span className="h-1.5 w-1/2 rounded-full bg-line" />
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
  "cold-calling": (
    <div className="grid w-full grid-cols-[2fr_1fr] gap-[2.5%]">
      <div className={cn(tile, "flex flex-col justify-around p-[4%]")}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="flex items-center gap-[3%]">
            <span className="aspect-square w-[5%] rounded-full bg-violet/40" />
            <span className="h-1.5 w-[35%] rounded-full bg-ink/40" />
            <span className="ml-auto h-1.5 w-[15%] rounded-full bg-line" />
          </span>
        ))}
      </div>
      <div className={cn(tile, "flex flex-col items-center justify-center gap-[8%] p-[6%]")}>
        <span className="aspect-square w-3/5 rounded-full border-4 border-teal/70" />
        <span className="h-2 w-1/2 rounded-full bg-teal/70" />
      </div>
    </div>
  ),
  calendar: (
    <div className="grid w-full grid-cols-7 grid-rows-5 gap-[1%]">
      {Array.from({ length: 35 }, (_, i) => (
        <span key={i} className={cn(tile, "flex flex-col gap-1 rounded-md p-[8%]")}>
          {i % 5 === 1 && <span className="h-1.5 w-full rounded-full bg-violet/70" />}
          {i % 7 === 3 && <span className="h-1.5 w-4/5 rounded-full bg-teal/70" />}
          {i % 11 === 4 && <span className="h-1.5 w-3/5 rounded-full bg-gold/70" />}
        </span>
      ))}
    </div>
  ),
  finance: (
    <div className="grid w-full grid-cols-[2fr_1fr] gap-[2.5%]">
      <div className={cn(tile, "flex items-end gap-[4%] p-[5%]")}>
        {[40, 55, 48, 70, 62, 85].map((height, i) => (
          <span key={i} className="flex flex-1 items-end gap-[8%]" style={{ height: "100%" }}>
            <span className="flex-1 rounded-t bg-teal/70" style={{ height: `${height}%` }} />
            <span className="flex-1 rounded-t bg-pink/50" style={{ height: `${height * 0.55}%` }} />
          </span>
        ))}
      </div>
      <div className={cn(tile, "p-[8%]")}>
        <Bars count={6} className="h-full justify-around" />
      </div>
    </div>
  ),
  jarvis: (
    <div className="flex w-full flex-col justify-end gap-[3%]">
      <span className="h-[12%] w-[45%] self-end rounded-2xl bg-violet/60" />
      <span className={cn(tile, "h-[22%] w-[60%] rounded-2xl")} />
      <span className="h-[8%] w-[30%] rounded-xl bg-teal/60" />
      <span className="mt-[3%] h-[12%] w-full rounded-xl border border-line bg-surface" />
    </div>
  ),
};
