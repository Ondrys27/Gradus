"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import type { PlanCatalog } from "@/config/pricing";
import { formatDateTime } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type { PlanImpact } from "../server/plans-data";
import {
  planCatalogImpact,
  restorePlanVersion,
  type PlansActionError,
} from "../server/plans-actions";
import { PlanChanges } from "./plans-changes";

export type HistoryVersion = {
  id: string;
  publishedAt: string | null;
  /** Who published it; null for the first version (the migration) or a deleted account. */
  publishedBy: string | null;
  catalog: PlanCatalog;
};

const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), ADMIN_FORMAT_SETTINGS) : "–");

/**
 * The published version and the earlier ones, newest first. Bringing one
 * back publishes a copy of it, after the same confirmation as publishing.
 */
export function PlansHistory({
  current,
  history,
  readOnly,
}: {
  current: HistoryVersion;
  history: HistoryVersion[];
  /** An admin: the list without bringing anything back. */
  readOnly: boolean;
}) {
  const t = useTranslations("admin.plans");
  const router = useRouter();
  const [restoring, setRestoring] = useState<{ version: HistoryVersion; impact: PlanImpact[] | null } | null>(
    null,
  );
  const [problem, setProblem] = useState<PlansActionError | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function ask(version: HistoryVersion) {
    setProblem(null);
    setDone(false);
    setRestoring({ version, impact: null });
    startTransition(async () => {
      const result = await planCatalogImpact(version.catalog).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      setRestoring((open) =>
        open?.version.id === version.id ? { version, impact: result.ok ? result.impact : [] } : open,
      );
    });
  }

  function restore() {
    if (!restoring) return;
    startTransition(async () => {
      const result = await restorePlanVersion(restoring.version.id, current.id).catch(
        () => ({ ok: false, error: "failed" }) as const,
      );
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setRestoring(null);
      setDone(true);
      router.refresh();
    });
  }

  const row = (version: HistoryVersion, isCurrent: boolean) => (
    <li
      key={version.id}
      className="flex flex-wrap items-center justify-between gap-3 py-3"
      data-testid="plan-version"
    >
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-medium text-ink tabular-nums">{when(version.publishedAt)}</span>
        <span className="truncate text-xs text-ink-muted">
          {version.publishedBy ?? t("history.noAuthor")}
        </span>
      </div>
      {isCurrent ? (
        <StatusPill tone="green">{t("history.current")}</StatusPill>
      ) : (
        !readOnly && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => ask(version)}>
            {t("history.restore")}
          </Button>
        )
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-2">
      {done && (
        <p role="status" className="text-sm text-ink-soft">
          {t("notices.restored")}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-line" data-testid="plan-history">
        {row(current, true)}
        {history.map((version) => row(version, false))}
      </ul>
      {history.length === 0 && <p className="text-sm text-ink-muted">{t("history.empty")}</p>}

      <ResponsiveDialog
        open={restoring !== null}
        onOpenChange={(open) => !pending && !open && setRestoring(null)}
        title={t("restoreConfirm.title", { date: when(restoring?.version.publishedAt ?? null) })}
        closeLabel={t("close")}
      >
        {restoring && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink-soft">{t("restoreConfirm.description")}</p>
            <div className="max-h-[50vh] overflow-y-auto">
              <PlanChanges from={current.catalog} to={restoring.version.catalog} impact={restoring.impact} />
            </div>
            {problem && <FormAlert>{t(`problems.${problem}`)}</FormAlert>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setRestoring(null)}>
                {t("cancel")}
              </Button>
              <Button type="button" disabled={pending} onClick={restore}>
                {t("restoreConfirm.confirm")}
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}
