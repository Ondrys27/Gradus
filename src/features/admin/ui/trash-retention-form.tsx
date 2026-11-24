"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { TRASH_RETENTION_MAX, TRASH_RETENTION_MIN, validRetention } from "@/features/trash/trash";
import { saveTrashRetention } from "../server/trash-actions";

/** The trash's retention in days (28.8); a limited admin reads it. */
export function TrashRetentionForm({ days, readOnly }: { days: number; readOnly: boolean }) {
  const t = useTranslations("admin.ai.trash");
  const [value, setValue] = useState(String(days));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const parsed = Number(value);
  return (
    <form
      id="kos"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validRetention(parsed))
          return setError(t("invalid", { min: TRASH_RETENTION_MIN, max: TRASH_RETENTION_MAX }));
        if (!window.confirm(t("confirm", { days: parsed }))) return;
        start(async () => {
          const result = await saveTrashRetention(parsed);
          if (!result.ok) setError(t(result.error === "invalid" ? "invalidShort" : "failed"));
          else setError(null);
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm text-ink-soft sm:max-w-xs">
        {t("label")}
        <Input
          type="number"
          inputMode="numeric"
          min={TRASH_RETENTION_MIN}
          max={TRASH_RETENTION_MAX}
          value={value}
          disabled={readOnly || pending}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {readOnly ? (
        <p className="text-xs text-ink-muted">{t("readOnly")}</p>
      ) : (
        <div>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      )}
      {error && <FormAlert>{error}</FormAlert>}
    </form>
  );
}
