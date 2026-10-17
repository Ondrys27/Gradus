"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  MAX_USER_USD,
  USER_CAP_MODES,
  userCapFormSchema,
  type UserCapMode,
} from "@/features/jarvis/caps";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { saveUserAiCap, type CapsActionResult } from "../server/ai-caps-actions";

const usd = (value: number) =>
  formatNumber(value, { style: "currency", currency: "USD", decimals: 2 }, ADMIN_FORMAT_SETTINGS);

/**
 * One user's exception to the AI caps: the app-wide caps, an own monthly cap
 * or AI blocked. Saving asks for confirmation from → to.
 */
export function UserAiCapForm({
  userId,
  mode: savedMode,
  capUsd: savedCap,
}: {
  userId: string;
  mode: UserCapMode;
  capUsd: number | null;
}) {
  const t = useTranslations("admin.users.aiCap");
  const router = useRouter();
  const [mode, setMode] = useState<UserCapMode>(savedMode);
  const [cap, setCap] = useState(savedCap === null ? "" : String(savedCap));
  const [capError, setCapError] = useState(false);
  const [notice, setNotice] = useState<"saved" | "noChanges" | null>(null);
  const [problem, setProblem] = useState<Exclude<CapsActionResult, { ok: true }>["error"] | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const input = mode === "cap" ? { mode, capUsd: cap } : { mode };
  const parsed = userCapFormSchema.safeParse(input);
  const nextCap = parsed.success && parsed.data.mode === "cap" ? parsed.data.capUsd : null;

  const summary = (m: UserCapMode, amount: number | null) =>
    m === "cap" ? t("summary.cap", { amount: usd(amount ?? 0) }) : t(`summary.${m}`);

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setProblem(null);
    if (!parsed.success) {
      setCapError(true);
      return;
    }
    setCapError(false);
    if (mode === savedMode && (mode !== "cap" || nextCap === savedCap)) {
      setNotice("noChanges");
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await saveUserAiCap(userId, input).catch(
        (): CapsActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setConfirming(false);
      setNotice("saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="user-ai-cap-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">{t("modeLabel")}</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {USER_CAP_MODES.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm text-ink-soft has-[:checked]:border-violet has-[:checked]:text-ink has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name="ai-cap-mode"
                value={option}
                checked={mode === option}
                onChange={() => {
                  setMode(option);
                  setNotice(null);
                }}
                className="size-4 accent-violet"
              />
              {t(`modes.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "cap" && (
        <FormField
          id="user-ai-cap"
          label={t("capLabel")}
          error={capError ? t("errors.capUsd", { max: usd(MAX_USER_USD) }) : undefined}
          hint={t("capHint", { max: usd(MAX_USER_USD) })}
          className="max-w-xs"
        >
          <Input
            {...fieldA11y("user-ai-cap", capError, true)}
            inputMode="decimal"
            autoComplete="off"
            value={cap}
            onChange={(event) => {
              setCap(event.target.value);
              setNotice(null);
            }}
          />
        </FormField>
      )}
      {notice && (
        <p role="status" className="text-sm text-ink-soft">
          {t(notice)}
        </p>
      )}
      {problem && !confirming && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </div>

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={t("confirmTitle")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-soft" data-testid="user-ai-cap-change">
            {t("confirmDescription", {
              from: summary(savedMode, savedCap),
              to: summary(mode, nextCap),
            })}
          </p>
          {problem && <FormAlert>{t(`errors.${problem}`)}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={confirm}>
              {t("confirm")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </form>
  );
}
