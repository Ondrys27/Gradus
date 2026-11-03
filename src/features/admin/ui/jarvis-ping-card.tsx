"use client";

import { useState } from "react";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import type { PingResult } from "@/features/jarvis/protocol";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";

const ENDPOINT = "/api/jarvis";
/** Four decimals: a short question costs a fraction of a cent. */
const COST_DECIMALS = 4;

/**
 * Administration → AI and Jarvis → Test the connection: one short question
 * to /api/jarvis as the signed-in owner, then whether the answer came, how
 * long it took and what it cost, or why not. Never throws; a refused or
 * broken answer comes back as a code with its own text.
 */
export function JarvisPingCard() {
  const t = useTranslations("admin.ai.connection");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);

  async function ping() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ping" }),
      });
      const body = (await response.json().catch(() => null)) as PingResult | null;
      setResult(
        body && typeof body.ok === "boolean" ? body : { ok: false, code: "unknown", durationMs: null },
      );
    } catch {
      setResult({ ok: false, code: "network", durationMs: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Button variant="outline" onClick={() => void ping()} disabled={busy} className="self-start">
        {busy ? (
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <SparklesIcon aria-hidden />
        )}
        {busy ? t("testing") : t("test")}
      </Button>
      {!busy && result && <Outcome result={result} />}
    </div>
  );
}

function Outcome({ result }: { result: PingResult }) {
  const t = useTranslations("admin.ai.connection");
  const tError = useTranslations("jarvis.error");
  const seconds = (ms: number) => formatNumber(ms / 1000, { decimals: 1 }, ADMIN_FORMAT_SETTINGS);

  if (result.ok) {
    return (
      <FormAlert tone="success">
        <p className="font-medium">{t("ok")}</p>
        <p className="text-ink-soft">
          {t("duration", { seconds: seconds(result.durationMs) })} ·{" "}
          {t("cost", {
            cost: formatCurrency(result.costUsd, "USD", ADMIN_FORMAT_SETTINGS, COST_DECIMALS),
          })}{" "}
          · {t("model", { model: result.model })}
        </p>
      </FormAlert>
    );
  }

  const reason =
    result.code === "limitReached"
      ? tError("limitReached", {
          limit: formatNumber(result.usage?.limit ?? 0, {}, ADMIN_FORMAT_SETTINGS),
        })
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
