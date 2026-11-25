"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  defineWidget,
  DetailHeading,
  Empty,
  type WidgetDetailProps,
  type WidgetViewProps,
} from "@/features/widgets/kit";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ERROR_GROUP_STATUSES, type ErrorGroupStatus } from "../../error-log";
import { ADMIN_FORMAT_SETTINGS } from "../../format-metric";
import { setErrorGroupStatus } from "../../server/error-log-actions";
import { ERROR_BADGE_EVENT } from "../error-badge-client";
import type { AdminWidgetData, WidgetErrorGroup } from "../data";
import { adminWidgetKeys, useAdminWidgetData } from "../use-widget-data";
import { StandardDetail, StandardView } from "../views";

/**
 * Errors (29.2), instead of an e-mail: new today, open, people hit, the three
 * most frequent with their code and the ones that came back. The detail
 * lists the new errors with a quick change of state; a click on one opens
 * it in the log (27.2).
 */
function ErrorsView(props: WidgetViewProps<AdminWidgetData>) {
  const t = useTranslations("admin.widgets.errors");
  const calm = props.data.figures.every((figure) => (figure.value ?? 0) === 0);
  if (calm && props.size !== "S") {
    return (
      <div className="flex min-h-0 flex-col gap-2" data-testid="errors-widget-calm">
        <Empty icon={CheckCircle2Icon} tone="green" title={t("calm")} hint={t("calmHint")} zero="0" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="errors-widget">
      <StandardView {...props} />
    </div>
  );
}

function ErrorsDetail(props: WidgetDetailProps<AdminWidgetData>) {
  const t = useTranslations("admin.widgets.errors");
  const groups = props.data.errors ?? [];
  return (
    <StandardDetail {...props}>
      <section className="flex flex-col gap-2">
        <DetailHeading>{t("newList")}</DetailHeading>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noneNew")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="errors-widget-new">
            {groups.map((group) => (
              <ErrorGroupItem key={group.fingerprint} group={group} onOpen={props.close} />
            ))}
          </ul>
        )}
      </section>
    </StandardDetail>
  );
}

function ErrorGroupItem({ group, onOpen }: { group: WidgetErrorGroup; onOpen: () => void }) {
  const t = useTranslations("admin.widgets.errors");
  const tStatus = useTranslations("admin.errors.status");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ErrorGroupStatus>(group.status);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: ErrorGroupStatus) {
    if (next === status) return;
    const before = status;
    setStatus(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setErrorGroupStatus(group.fingerprint, next);
      if (!result.ok) {
        setStatus(before);
        setFailed(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: adminWidgetKeys.all });
      window.dispatchEvent(new Event(ERROR_BADGE_EVENT));
    });
  }

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="errors-widget-group" data-code={group.code}>
      <Link
        href={`/admin/chyby?group=${group.fingerprint}`}
        onClick={onOpen}
        className="flex min-w-0 flex-col gap-0.5 rounded-lg outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
        data-testid="errors-widget-link"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          <code className="font-mono text-xs text-ink-soft">{group.code}</code>
          {group.returned && (
            <span className="rounded-full bg-gold/15 px-2 text-[11px] font-medium text-gold">
              {t("cameBack")}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-ink">{group.message}</span>
        <span className="text-xs text-ink-muted">
          {t("groupMeta", {
            page: group.page,
            occurrences: group.occurrences,
            users: group.users,
            at: formatDateTime(new Date(group.lastAt), ADMIN_FORMAT_SETTINGS),
          })}
        </span>
      </Link>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("changeStatus")}>
        {ERROR_GROUP_STATUSES.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === status ? "default" : "outline"}
            disabled={pending}
            aria-pressed={value === status}
            onClick={() => change(value)}
            className={cn("min-h-9")}
          >
            {tStatus(value)}
          </Button>
        ))}
      </div>
      {failed && <p className="text-xs text-pink">{t("statusFailed")}</p>}
    </li>
  );
}

export const errorsWidget = defineWidget<AdminWidgetData>({
  key: "errors",
  useData: (settings) => useAdminWidgetData("errors", settings),
  View: ErrorsView,
  Detail: ErrorsDetail,
});
