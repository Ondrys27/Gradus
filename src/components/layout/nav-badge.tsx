"use client";

import { useTranslations } from "next-intl";
import { badgeText } from "@/features/chat/logic";

/** The unread count on a menu icon (Messages); nothing at zero. */
export function NavBadge({ count }: { count: number }) {
  const t = useTranslations("nav");
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden
        data-testid="nav-unread-badge"
        className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-teal px-1 text-[10px] leading-none font-bold text-canvas shadow-[0_0_8px_var(--color-teal)]"
      >
        {badgeText(count)}
      </span>
      <span className="sr-only">{t("unread", { count })}</span>
    </>
  );
}
