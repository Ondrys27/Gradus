"use client";

import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  showLabel: string;
  hideLabel: string;
};

export function PasswordInput({ className, showLabel, hideLabel, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={cn("field pr-12", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-xl text-ink-muted outline-none hover:text-ink focus-visible:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {visible ? (
          <EyeOffIcon aria-hidden className="size-4.5" />
        ) : (
          <EyeIcon aria-hidden className="size-4.5" />
        )}
      </button>
    </div>
  );
}
