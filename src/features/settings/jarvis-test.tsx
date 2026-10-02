"use client";

import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import type { PingResult } from "@/features/jarvis/protocol";
import { usePingJarvis } from "@/features/jarvis/queries";
import { formatCurrency, formatNumber, type FormatSettings } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";

/** Four decimals: a short question costs a fraction of a cent. */
const COST_DECIMALS = 4;

/**
 * Settings → Integrations: one tap sends Jarvis a short question and shows
 * whether the answer came, how long it took and what it cost, or why not.
 */
export function JarvisTest() {
  const t = useTranslations("settings.integrations.jarvis");
  const ping = usePingJarvis();
  const settings = useFormatSettings();
  const result = ping.data;

  return (
    <div className="flex flex-col gap-4 border-t border-line/60 pt-5">
      <h3 className="text-[15px] font-semibold text-ink">{t("name")}</h3>
      <p className="text-sm text-ink-soft">{t("description")}</p>
      <Button
        variant="outline"
        onClick={() => ping.mutate()}
        disabled={ping.isPending}
        className="min-h-11 self-start mouse:min-h-9"
      >
        {ping.isPending ? (
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <SparklesIcon aria-hidden />
        )}
        {ping.isPending ? t("testing") : t("test")}
      </Button>
      {!ping.isPending && result && <Outcome result={result} settings={settings} />}
    </div>
  );
}

function Outcome({ result, settings }: { result: PingResult; settings: FormatSettings }) {
  const t = useTranslations("settings.integrations.jarvis");
  const tError = useTranslations("jarvis.error");
  const seconds = (ms: number) => formatNumber(ms / 1000, { decimals: 1 }, settings);

  if (result.ok) {
    return (
      <FormAlert tone="success">
        <p className="font-medium">{t("ok")}</p>
        <p className="text-ink-soft">
          {t("duration", { seconds: seconds(result.durationMs) })} ·{" "}
          {t("cost", { cost: formatCurrency(result.costUsd, "USD", settings, COST_DECIMALS) })} ·{" "}
          {t("model", { model: result.model })}
        </p>
      </FormAlert>
    );
  }

  const reason =
    result.code === "limitReached"
      ? tError("limitReached", { limit: formatNumber(result.usage?.limit ?? 0, {}, settings) })
      : tError(result.code);
  return (
    <FormAlert>
      <p className="font-medium">{t("failed")}</p>
      <p className="text-ink">{reason}</p>
      {result.durationMs !== null && (
        <p className="text-ink-soft">{t("failedAfter", { seconds: seconds(result.durationMs) })}</p>
      )}
    </FormAlert>
  );
}
