"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon } from "lucide-react";

/** The account id as a small, selectable code with a Copy button (user detail only). */
export function CopyId({ id }: { id: string }) {
  const t = useTranslations("admin.users");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is selectable, so it can be copied by hand.
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-muted">
      <span>{t("idLabel")}</span>
      <code className="min-w-0 truncate font-mono select-all">{id}</code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
      >
        {copied ? (
          <CheckIcon aria-hidden className="size-3.5 text-teal" />
        ) : (
          <CopyIcon aria-hidden className="size-3.5" />
        )}
        {copied ? t("copied") : t("copyId")}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}
