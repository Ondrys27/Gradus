import { cn } from "@/lib/utils";
import { toneText, type Tone } from "@/components/ui/tone";

type SparklineProps = {
  /** Values from 0 to 1; null where there is nothing to draw. */
  values: (number | null)[];
  tone?: Tone;
  /** Read out by screen readers in place of the picture. */
  label: string;
  className?: string;
};

const WIDTH = 100;
const HEIGHT = 32;
const PAD = 3;

type Point = { x: number; y: number };

function toPoints(values: (number | null)[]): Point[][] {
  const step = values.length > 1 ? (WIDTH - PAD * 2) / (values.length - 1) : 0;
  const runs: Point[][] = [];
  let run: Point[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({
      x: PAD + index * step,
      y: PAD + (1 - Math.min(Math.max(value, 0), 1)) * (HEIGHT - PAD * 2),
    });
  });
  if (run.length) runs.push(run);
  return runs;
}

/** A small trend line. The stroke does not scale with the box, so it stays crisp at any width. */
export function Sparkline({ values, tone = "gold", label, className }: SparklineProps) {
  const runs = toPoints(values);
  const last = runs.at(-1)?.at(-1);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("h-10 w-full overflow-visible", toneText[tone], className)}
    >
      {runs.map((run, index) =>
        run.length > 1 ? (
          <polyline
            key={index}
            points={run.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          // A run of one point is a short dash, so a single closed deal still shows.
          <line
            key={index}
            x1={run[0].x - 2}
            x2={run[0].x + 2}
            y1={run[0].y}
            y2={run[0].y}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
      {last && (
        <line
          x1={last.x}
          x2={last.x}
          y1={last.y}
          y2={last.y}
          stroke="currentColor"
          strokeWidth={7}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
