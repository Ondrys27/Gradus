"use client";

import Link from "next/link";
import { SearchIcon, TagsIcon, TicketPercentIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { defineWidget, READY, type WidgetViewProps } from "@/features/widgets/kit";
import { cn } from "@/lib/utils";
import { adminCan, type AdminPower } from "../../roles";
import { useAdminActor } from "../actor";

/** The administration's everyday shortcuts; each needs what its page needs to change (29.2). */
const ACTIONS: readonly { key: string; href: string; icon: LucideIcon; power?: AdminPower }[] = [
  { key: "findUser", href: "/admin/uzivatele#users-search", icon: SearchIcon },
  { key: "promoCode", href: "/admin/promo-kody#promo-codes", icon: TicketPercentIcon },
  { key: "publishPlans", href: "/admin/tarify#plans-editor", icon: TagsIcon, power: "editPlans" },
];

function QuickActionsView({ size }: WidgetViewProps<true>) {
  const t = useTranslations("admin.widgets.quickActions.actions");
  const actor = useAdminActor();
  const actions = ACTIONS.filter((action) => !action.power || adminCan(actor, action.power));
  return (
    <div className={cn("grid gap-2", size === "S" ? "grid-cols-1" : "grid-cols-1 @xs:grid-cols-3")} data-no-open="">
      {actions.map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10 justify-start")}
          data-testid={`admin-quick-${key}`}
        >
          <Icon aria-hidden data-icon="inline-start" />
          <span className="truncate">{t(key as "findUser")}</span>
        </Link>
      ))}
    </div>
  );
}

export const quickActionsWidget = defineWidget<true>({
  key: "quickActions",
  useData: () => READY,
  View: QuickActionsView,
  Detail: () => null,
});
