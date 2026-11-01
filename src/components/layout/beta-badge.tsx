import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Whether the Beta label shows (NEXT_PUBLIC_BETA=true). Inlined at build time. */
export const BETA_ENABLED = process.env.NEXT_PUBLIC_BETA === "true";

/** A small, quiet "Beta" next to the logo; nothing when the app is not in beta. */
export function BetaBadge({ className }: { className?: string }) {
  const t = useTranslations("nav");
  if (!BETA_ENABLED) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-line-strong px-1.5 text-[10px] leading-none font-semibold tracking-wide text-ink-muted uppercase",
        className,
      )}
    >
      {t("beta")}
    </span>
  );
}
