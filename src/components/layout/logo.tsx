import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** The app mark: the first letter of the name on the brand gradient. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-violet to-teal text-base font-black text-canvas shadow-glow",
        className,
      )}
    >
      {APP_NAME.charAt(0)}
    </span>
  );
}
