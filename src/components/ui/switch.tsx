"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The ::after expands the touch target to 44 px without changing the visual size.
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-line bg-canvas-deep p-0.5 transition-colors outline-none after:absolute after:-inset-2.5 after:content-['']",
        "focus-visible:ring-3 focus-visible:ring-violet/30 data-checked:border-violet data-checked:bg-violet data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4.5 rounded-full bg-ink-muted shadow-sm transition-[translate,background-color] duration-200 ease-out data-checked:translate-x-5 data-checked:bg-white" />
    </SwitchPrimitive.Root>
  );
}
