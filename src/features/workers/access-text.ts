"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { accessSentences, sectionNavKey } from "./access-summary";
import type { PermissionGrants } from "./permissions-catalog";

/** The access summary of these grants in the interface's language (30.2). */
export function useAccessSentences(grants: PermissionGrants) {
  const t = useTranslations("workers.access");
  const tNav = useTranslations("nav");
  const tPermissions = useTranslations("workers.permissions");
  return useMemo(
    () =>
      accessSentences(
        grants,
        (key, values) => t(key as "always", values),
        (section) =>
          section === "invoices" ? tPermissions("sections.invoices") : tNav(sectionNavKey(section) as "dashboard"),
      ),
    [grants, t, tNav, tPermissions],
  );
}
