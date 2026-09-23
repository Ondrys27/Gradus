"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit for server-action forms: disabled with a spinner while the action runs. */
export function SubmitButton({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className={className}>
      {pending && (
        <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </Button>
  );
}
