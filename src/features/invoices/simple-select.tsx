"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SimpleOption = { value: string; label: string };

/** A select of plain options, as the invoice forms need it. */
export function SimpleSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  options: SimpleOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const items = useMemo(() => options.map(({ value, label }) => ({ value, label })), [options]);
  return (
    <Select
      value={value}
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
    >
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[min(var(--available-height),360px)]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
