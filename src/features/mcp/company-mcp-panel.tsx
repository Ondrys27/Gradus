"use client";

import { useTranslations } from "next-intl";
import { PlugZapIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { CompanyPerson } from "@/features/workers/company/tree";
import { useCompanyMcp, useSetCompanyMcp } from "./queries";

/**
 * Company → People, the owner's line about connected apps (28.8): who of the
 * company has Claude (or another MCP client) connected here, and the switch
 * that turns connected apps off for the whole company at once. Each
 * worker's own right is "Integrations: MCP" in their rights.
 */
export function CompanyMcpPanel({ people }: { people: CompanyPerson[] | undefined }) {
  const t = useTranslations("mcp.company");
  const state = useCompanyMcp(true);
  const toggle = useSetCompanyMcp();
  if (!state.data) return null;
  const names = state.data.clients
    .map((row) => people?.find((person) => person.id === row.workerId)?.name)
    .filter((name): name is string => Boolean(name));
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <PlugZapIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-teal" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">{t("title")}</span>
          <span className="text-xs text-ink-muted">
            {!state.data.enabled
              ? t("off")
              : names.length
                ? t("connected", { names: names.join(", "), count: names.length })
                : t("nobody")}
          </span>
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
        <Switch
          checked={state.data.enabled}
          disabled={toggle.isPending}
          onCheckedChange={(value) => toggle.mutate(Boolean(value))}
          aria-label={t("switch")}
        />
        {t("switch")}
      </label>
    </div>
  );
}
