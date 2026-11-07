import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

/** The label on every row of the tutorial's sample data: "sample". Nothing for real rows. */
export function DemoBadge({ show, className }: { show?: boolean | null; className?: string }) {
  const t = useTranslations("tutorial");
  if (!show) return null;
  return (
    <StatusPill tone="gold" data-demo-badge="" className={cn("h-5 px-2 text-[11px]", className)}>
      {t("demoBadge")}
    </StatusPill>
  );
}
