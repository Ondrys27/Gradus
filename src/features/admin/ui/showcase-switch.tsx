"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { Switch } from "@/components/ui/switch";
import { saveShowcaseMode } from "../server/showcase-actions";

/** The showcase mode's switch (step 27.4); a limited admin sees it read-only. */
export function ShowcaseSwitch({ enabled, readOnly }: { enabled: boolean; readOnly: boolean }) {
  const t = useTranslations("admin.showcase");
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3" id="ukazkovy-rezim">
      <label className="flex min-h-11 items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{t("switch")}</span>
          <span className="text-sm text-ink-soft">{value ? t("on") : t("off")}</span>
        </span>
        <Switch
          checked={value}
          disabled={readOnly || pending}
          aria-label={t("switch")}
          data-testid="showcase-switch"
          onCheckedChange={(next) => {
            setFailed(false);
            setValue(next);
            startTransition(async () => {
              const result = await saveShowcaseMode(next);
              if (!result.ok) {
                setValue(!next);
                setFailed(true);
                return;
              }
              router.refresh();
            });
          }}
        />
      </label>
      {readOnly && <p className="text-xs text-ink-muted">{t("readOnly")}</p>}
      {failed && <FormAlert>{t("failed")}</FormAlert>}
    </div>
  );
}
