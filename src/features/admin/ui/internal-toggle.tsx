"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { toggleUserInternal } from "../server/mutations";

/** profiles.is_internal, changed right from the list or the detail page. */
export function InternalToggle({ userId, value }: { userId: string; value: boolean }) {
  const t = useTranslations("admin.users");
  const router = useRouter();
  const [checked, setChecked] = useState(value);
  const [pending, startTransition] = useTransition();

  function onChange(next: boolean) {
    const previous = checked;
    setChecked(next);
    startTransition(async () => {
      const result = await toggleUserInternal(userId, next);
      if (!result.ok) setChecked(previous);
      else router.refresh();
    });
  }

  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-ink-soft">
      <Switch checked={checked} disabled={pending} onCheckedChange={onChange} />
      {t("internal")}
    </label>
  );
}
