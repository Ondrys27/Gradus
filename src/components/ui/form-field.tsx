import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./input";

type FormFieldProps = {
  id: string;
  label: ReactNode;
  /** Shown in pink under the control; pair it with `aria-invalid` on the control. */
  error?: ReactNode;
  /** Neutral help text, hidden while there is an error. */
  hint?: ReactNode;
  /** Extra element on the label row, e.g. a "Forgot password?" link. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function FormField({ id, label, error, hint, aside, className, children }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-message`} className="text-xs text-pink" aria-live="polite">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props that tie a control to its FormField message. */
export function fieldA11y(id: string, error?: unknown, hint?: unknown) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error || hint ? `${id}-message` : undefined,
  } as const;
}
