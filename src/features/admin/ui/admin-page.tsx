import type { ReactNode } from "react";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { metricsToday } from "@/lib/analytics/metrics";
import { countryName } from "@/lib/format";
import type { AdminQuery } from "../server/metrics-data";
import { openSegmentValues, safe } from "../server/metrics-data";
import type { Loaded } from "../types";
import { AdminBlockError } from "./blocks";
import { AdminControls, type OpenSegmentOptions } from "./admin-controls";
import { AdminPageBar } from "./page-bar";

export { AdminPageBar };

/**
 * The bar of a page with the shared controls: its name and sentence on the
 * left, the period, comparison and filters on the right; `extra` goes under
 * the bar (a search field, a row of tabs).
 */
export async function AdminPageHeader({
  section,
  q,
  extra,
}: {
  section: string;
  q: AdminQuery;
  extra?: ReactNode;
}) {
  void q; // The period and comparison show in the controls themselves.
  const [t, tIndustry, locale, values] = await Promise.all([
    getTranslations(`admin.${section}`),
    getTranslations("onboarding.industry.industries"),
    getLocale(),
    safe("segment values", openSegmentValues),
  ]);
  const openOptions: OpenSegmentOptions = values.ok
    ? {
        industry: values.data.industry.map((value) => ({
          value,
          label: tIndustry.has(`${value}.label`) ? tIndustry(`${value}.label`) : value,
        })),
        country: values.data.country.map((value) => ({
          value,
          label: countryName(value, locale),
        })),
      }
    : {};

  return (
    <Suspense fallback={<AdminPageBar title={t("title")} description={t("description")} />}>
      <AdminControls
        today={metricsToday()}
        openOptions={openOptions}
        title={t("title")}
        description={t("description")}
        extra={extra}
      />
    </Suspense>
  );
}

/** Renders a block that loaded, or a short note with a retry when it could not. */
export function Show<T>({
  loaded,
  children,
}: {
  loaded: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  if (!loaded.ok) return <AdminBlockError />;
  return <>{children(loaded.data)}</>;
}
