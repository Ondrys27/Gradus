"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Switch } from "@/components/ui/switch";
import { ERROR_GROUP_STATUSES, type ErrorGroupStatus } from "../error-log";
import { setErrorGroupStatus, setPeerNotices } from "../server/error-log-actions";

/** New · Being fixed · Resolved · Ignore: the current one pressed, the others one click away. */
export function ErrorStatusButtons({
  fingerprint,
  status,
}: {
  fingerprint: string;
  status: ErrorGroupStatus;
}) {
  const t = useTranslations("admin.errors");
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: ErrorGroupStatus) {
    if (next === current) return;
    setFailed(false);
    const before = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setErrorGroupStatus(fingerprint, next).catch(() => ({ ok: false }) as const);
      if (!result.ok) {
        setCurrent(before);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("statusLabel")} className="flex flex-wrap gap-2" data-testid="error-status">
        {ERROR_GROUP_STATUSES.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === current ? "default" : "outline"}
            aria-pressed={value === current}
            disabled={pending}
            onClick={() => choose(value)}
          >
            {t(`status.${value}`)}
          </Button>
        ))}
      </div>
      {failed && <FormAlert>{t("statusFailed")}</FormAlert>}
    </div>
  );
}

/** One's own switch for the e-mails "X changed the plans / the AI caps". */
export function PeerNoticesSwitch({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.errors.peer");
  const [on, setOn] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setFailed(false);
    setOn(next);
    startTransition(async () => {
      const result = await setPeerNotices(next).catch(() => ({ ok: false }) as const);
      if (!result.ok) {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">{t("label")}</span>
          <span className="text-xs text-ink-muted">{t("hint")}</span>
        </span>
        <Switch
          checked={on}
          disabled={pending}
          onCheckedChange={(value) => toggle(value)}
          aria-label={t("label")}
          data-testid="peer-notices-switch"
        />
      </label>
      {failed && <FormAlert>{t("failed")}</FormAlert>}
    </div>
  );
}
