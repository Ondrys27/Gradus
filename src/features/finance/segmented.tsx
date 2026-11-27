"use client";

import { cn } from "@/lib/utils";

type Props<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Ids of the panels the tabs control, one per option, so screen readers can follow. */
  panelId?: (value: T) => string;
  /** Passed to the tab row, for the guide (30.8). */
  "data-tutorial"?: string;
};

/** Tabs as a pill row; 44 px tall targets on touch screens. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  panelId,
  "data-tutorial": tutorial,
}: Props<T>) {
  return (
    <div
      role="tablist"
      data-tutorial={tutorial}
      aria-label={label}
      className="flex w-full rounded-full border border-line p-0.5 sm:w-fit"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          id={`tab-${option.value}`}
          aria-selected={value === option.value}
          aria-controls={panelId?.(option.value)}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-11 flex-1 cursor-pointer rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40 sm:flex-none mouse:h-9",
            value === option.value ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
