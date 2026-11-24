"use client";

import { useMemo, useState } from "react";
import { FlaskConicalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { track } from "@/lib/analytics/client";
import { formatDate, formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { definitionErrors, type RuleDefinition } from "./definition";
import { simulate, type Simulation } from "./evaluate";
import { useRewardHistory } from "./queries";

/**
 * "Try it" (29.1): what the rule would have paid the person in the last 30
 * days on their real work, and the first 10 events it would have paid. A
 * dry run in the browser over reward_history(); nothing is written.
 */
export function RuleTry({
  workerId,
  definition,
  currency,
  auto = false,
}: {
  workerId: string;
  definition: RuleDefinition;
  currency: string;
  /** Run at once (Grady's proposals show the result next to each rule). */
  auto?: boolean;
}) {
  const t = useTranslations("workers.rewardPlan.try");
  const settings = useFormatSettings();
  const [asked, setAsked] = useState(auto);
  const history = useRewardHistory(workerId, asked);
  const valid = definitionErrors(definition).length === 0;
  const result: Simulation | null = useMemo(
    () =>
      history.data && valid
        ? simulate(definition, history.data, { planCurrency: currency, timeZone: settings.timeZone })
        : null,
    [history.data, valid, definition, currency, settings.timeZone],
  );

  function run() {
    setAsked(true);
    track("reward_rule_tried", { event: definition.event.key, from: auto ? "grady" : "editor" });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="reward-try">
      {!asked ? (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={!valid} onClick={run}>
          <FlaskConicalIcon aria-hidden data-icon="inline-start" />
          {t("button")}
        </Button>
      ) : history.isError ? (
        <FormAlert>{t("failed")}</FormAlert>
      ) : !result ? (
        valid ? <Skeleton className="h-10 w-full rounded-xl" /> : null
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-teal/30 bg-teal/5 px-3 py-2.5" data-testid="reward-try-result">
          <p className="text-sm text-ink">
            {result.count === 0
              ? t("nothing")
              : t("total", {
                  amount: result.totals.map((item) => formatPrice(item.amount, item.currency, settings)).join(" + "),
                  count: result.count,
                })}
          </p>
          {result.first.length > 0 && (
            <ul className="flex flex-col divide-y divide-line/50 text-xs">
              {result.first.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="flex items-center gap-3 py-1.5">
                  <span className="w-20 shrink-0 text-ink-muted tabular-nums">
                    {formatDate(new Date(entry.at), settings)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft">
                    {entry.bonus ? t("bonus") : (entry.note ?? t("noName"))}
                  </span>
                  <span className="shrink-0 font-medium text-ink tabular-nums">
                    {formatPrice(entry.amount, entry.currency, settings)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">{t("hint")}</p>
        </div>
      )}
    </div>
  );
}
