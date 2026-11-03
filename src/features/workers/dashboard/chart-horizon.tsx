"use client";

import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import { Segmented } from "@/features/finance/segmented";
import { shiftIsoDate } from "@/features/crm-tasks/logic";
import type { IsoDate } from "@/lib/format";
import { HORIZONS, type Horizon, type HorizonKind } from "./chart-logic";

/** Week · month · quarter · year · own range; a custom range starts as the last 30 days. */
export function HorizonPicker({
  value,
  today,
  onChange,
}: {
  value: Horizon;
  today: IsoDate;
  onChange: (horizon: Horizon) => void;
}) {
  const t = useTranslations("workers.dashboard.overview.horizon");

  function pick(kind: HorizonKind) {
    if (kind === "custom") {
      onChange({ kind, from: shiftIsoDate(today, -29), to: today });
    } else {
      onChange({ kind });
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <Segmented
        label={t("label")}
        value={value.kind}
        options={HORIZONS.map((kind) => ({ value: kind, label: t(kind) }))}
        onChange={pick}
      />
      {value.kind === "custom" && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <DatePicker
            value={value.from}
            onValueChange={(from) => from && onChange({ ...value, from })}
            placeholder={t("from")}
            className="sm:w-40"
          />
          <DatePicker
            value={value.to}
            onValueChange={(to) => to && onChange({ ...value, to })}
            placeholder={t("to")}
            className="sm:w-40"
          />
        </div>
      )}
    </div>
  );
}
