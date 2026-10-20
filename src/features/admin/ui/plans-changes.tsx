"use client";

import { useLocale, useTranslations } from "next-intl";
import type { CatalogFeature, PlanCatalog } from "@/config/pricing";
import {
  diffPlanCatalogs,
  loweredLimits,
  planName,
  type CatalogChange,
  type ChangeValue,
} from "@/features/plan/catalog";
import { formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type { PlanImpact } from "../server/plans-data";

const count = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);
const amount = (value: number) =>
  formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 2 }, ADMIN_FORMAT_SETTINGS);

/**
 * What a publish or a restore changes, plan by plan: every value from → to,
 * lines added to or removed from the card, how many accounts are on the plan
 * and, where a limit goes down, how many of them are over it (read-only from
 * the next day, nothing deleted).
 */
export function PlanChanges({
  from,
  to,
  impact,
}: {
  from: PlanCatalog;
  to: PlanCatalog;
  /** Null while it loads or when it could not be read. */
  impact: PlanImpact[] | null;
}) {
  const t = useTranslations("admin.plans");
  const locale = useLocale();
  const changes = diffPlanCatalogs(from, to);
  const lowered = loweredLimits(from, to);
  const plans = [...new Set(changes.map((change) => change.plan))];

  if (plans.length === 0) {
    return (
      <p className="text-sm text-ink-soft" data-testid="plan-changes">
        {t("diff.none")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4" data-testid="plan-changes">
      {plans.map((key) => {
        const name = planName(to, key, locale) ?? key;
        const users = impact?.find((row) => row.plan === key);
        const planLowered = lowered.filter((item) => item.plan === key);
        return (
          <li key={key} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <h3 className="text-sm font-semibold text-ink">{name}</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {changes
                .filter((change) => change.plan === key)
                .map((change) => (
                  <ChangeRow key={change.field} change={change} />
                ))}
            </ul>
            <div className="flex flex-col gap-1 border-t border-line pt-2 text-xs text-ink-soft">
              {users ? (
                <span>{t("diff.users", { count: users.users, formatted: count(users.users) })}</span>
              ) : impact === null ? (
                <span>{t("diff.usersLoading")}</span>
              ) : null}
              {planLowered.length > 0 && users && (
                <span
                  className={users.overLimit > 0 ? "font-semibold text-orange" : undefined}
                  data-testid={`plan-over-${key}`}
                >
                  {users.overLimit > 0
                    ? t("diff.overLimit", { count: users.overLimit, formatted: count(users.overLimit) })
                    : t("diff.noneOver")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ChangeRow({ change }: { change: CatalogChange }) {
  const t = useTranslations("admin.plans");
  const label = fieldLabel(change.field, t);
  if (change.field === "features") {
    const from = change.from as CatalogFeature[];
    const to = change.to as CatalogFeature[];
    const key = (line: CatalogFeature) => `${line.cs}\u0000${line.en}`;
    const added = to.filter((line) => !from.some((other) => key(other) === key(line)));
    const removed = from.filter((line) => !to.some((other) => key(other) === key(line)));
    return (
      <li className="flex flex-col gap-1">
        <span className="text-ink-soft">{label}</span>
        {added.map((line, index) => (
          <span key={`a${index}`} className="text-green">
            + {line.cs} / {line.en}
          </span>
        ))}
        {removed.map((line, index) => (
          <span key={`r${index}`} className="text-pink line-through">
            − {line.cs} / {line.en}
          </span>
        ))}
        {added.length === 0 && removed.length === 0 && (
          <span className="text-ink">{t("diff.featuresReordered")}</span>
        )}
      </li>
    );
  }
  return (
    <li className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold break-all text-ink tabular-nums">
        {value(change.field, change.from, t)} → {value(change.field, change.to, t)}
      </span>
    </li>
  );
}

type T = ReturnType<typeof useTranslations<"admin.plans">>;

/** "name.cs" → "Název (CS)", "monthly.EUR" → "Měsíčně (EUR)", "limits.workers" → "Pracovníci". */
function fieldLabel(field: string, t: T): string {
  const [head, tail] = field.split(".");
  if (head === "limits") return t(`limits.${tail as "workers"}`);
  const base = t(`fields.${head as "name"}`);
  return tail ? `${base} (${tail.toUpperCase()})` : base;
}

function value(field: string, raw: ChangeValue, t: T): string {
  if (typeof raw === "boolean") return raw ? t("diff.yes") : t("diff.no");
  if (field === "order" && typeof raw === "number") return String(raw + 1);
  if (raw === null) return field.startsWith("limits.") ? t("diff.unlimited") : t("diff.empty");
  if (typeof raw === "number") return field.startsWith("limits.") ? count(raw) : amount(raw);
  if (typeof raw === "string") return raw || t("diff.empty");
  return "";
}
