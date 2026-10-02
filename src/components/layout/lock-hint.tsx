"use client";

import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { NavItemState } from "./use-nav";

/** What opens a locked section: the path milestone by name, or the level. */
export function LockHintText({ item }: { item: NavItemState }) {
  const t = useTranslations("nav.locked");
  const settings = useFormatSettings();
  const hint = item.lockHint;
  if (hint?.kind === "milestone") return t("milestone", { milestone: hint.title });
  if (hint?.kind === "level") return t("level", { level: formatNumber(hint.level, {}, settings) });
  return t("path");
}
