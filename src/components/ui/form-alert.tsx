import type { ReactNode } from "react";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Form-level message above the submit button. */
export function FormAlert({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? AlertCircleIcon : CheckCircle2Icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        tone === "error"
          ? "border-pink/40 bg-pink/10 text-pink"
          : "border-green/40 bg-green/10 text-green",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
