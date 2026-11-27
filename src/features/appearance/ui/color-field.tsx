"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeHex } from "../color";

/**
 * One colour of a custom theme: the system colour picker and the HEX text
 * side by side. The text applies as soon as it is a valid colour; on leaving
 * the field a half-typed value goes back to the last valid one.
 */
export function ColorField({
  id,
  label,
  value,
  warning,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  /** A contrast problem of this colour, shown under it. */
  warning?: string | null;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1" data-color-field={id}>
      <label htmlFor={`${id}-hex`} className="text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="relative size-11 shrink-0 overflow-hidden rounded-xl border border-line-strong mouse:size-10">
          <input
            type="color"
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
          />
        </span>
        <Input
          id={`${id}-hex`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-invalid={warning ? true : undefined}
          className={cn("font-mono text-sm uppercase", warning && "border-orange")}
          onChange={(event) => {
            setText(event.target.value);
            const hex = normalizeHex(event.target.value);
            if (hex && event.target.value.replace("#", "").length === 6) onChange(hex);
          }}
          onBlur={() => setText(value)}
        />
      </div>
      {warning && (
        <p className="flex items-center gap-1 text-xs text-orange">
          <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  );
}
