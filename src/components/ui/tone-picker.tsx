"use client";

import { cn } from "@/lib/utils";
import { toneFill, type Tone } from "./tone";

/** Colour chips; the value is a design tone, never a hex. */
export function TonePicker<T extends Tone>({
  tones,
  value,
  onChange,
  label,
  labelOf,
}: {
  tones: readonly T[];
  value: T;
  onChange: (tone: T) => void;
  label: string;
  /** The accessible name of each chip, e.g. "Teal". */
  labelOf: (tone: T) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-soft">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {tones.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-pressed={value === tone}
            aria-label={labelOf(tone)}
            onClick={() => onChange(tone)}
            className={cn(
              "grid size-11 cursor-pointer place-items-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
              value === tone ? "border-ink" : "border-line",
            )}
          >
            <span className={cn("size-5 rounded-full", toneFill[tone])} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
