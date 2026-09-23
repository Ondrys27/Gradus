"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // The ::after expands the touch target to 46 px without changing the visual size.
        "relative grid size-5.5 shrink-0 cursor-pointer place-items-center rounded-md border-2 border-line-strong bg-canvas-deep transition-colors outline-none after:absolute after:-inset-3 after:content-['']",
        "focus-visible:ring-3 focus-visible:ring-violet/30 data-checked:border-teal data-checked:bg-teal data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-canvas data-unchecked:hidden">
        <CheckIcon className="size-3.5" strokeWidth={3.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
