import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { formatCalendarDate } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type { AdminQuery } from "../server/metrics-data";
import type { Loaded } from "../types";
import { AdminBlockError } from "./blocks";

function rangeText(range: { from: string; to: string }): string {
  const from = formatCalendarDate(range.from, ADMIN_FORMAT_SETTINGS);
  const to = formatCalendarDate(range.to, ADMIN_FORMAT_SETTINGS);
  return range.from === range.to ? from : `${from} – ${to}`;
}

/** Title of an administration page with the period it shows and what it compares with. */
export async function AdminPageHeader({ section, q }: { section: string; q: AdminQuery }) {
  const [t, tControls] = await Promise.all([
    getTranslations(`admin.${section}`),
    getTranslations("admin.controls"),
  ]);
  return (
    <PageHeader
      title={t("title")}
      description={
        <>
          {t("description")}{" "}
          <span className="text-ink-muted">
            {q.previous
              ? tControls("rangeCompared", {
                  range: rangeText(q.range),
                  previous: rangeText(q.previous),
                })
              : tControls("range", { range: rangeText(q.range) })}
          </span>
        </>
      }
    />
  );
}

/** Renders a block that loaded, or a short note when it could not. */
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
