"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckIcon, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setPayoutStatus, setPromoCodeActive, type PayoutResult } from "../server/promo-actions";

/** Copies a partner's link (…/?kod=XYZ); the link is also selectable by hand. */
export function CopyPromoLink({ link }: { link: string }) {
  const t = useTranslations("admin.promoCodes.actions");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(link).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      title={link}
      data-testid="promo-copy-link"
    >
      {copied ? <CheckIcon aria-hidden className="text-teal" /> : <LinkIcon aria-hidden />}
      {copied ? t("copied") : t("copyLink")}
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </Button>
  );
}

/** Deactivate (or activate again) a code: it stops working at once, nothing is deleted. */
export function PromoActiveToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("admin.promoCodes");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        className={active ? "text-ink-soft" : undefined}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const result = await setPromoCodeActive(id, !active).catch(() => ({
              ok: false as const,
            }));
            if (result.ok) router.refresh();
            else setFailed(true);
          })
        }
        data-testid={active ? "promo-deactivate" : "promo-activate"}
      >
        {active ? t("actions.deactivate") : t("actions.activate")}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-pink">
          {t("errors.failed")}
        </span>
      )}
    </>
  );
}

/**
 * What the owner does with one payout: approve it, take the approval back,
 * mark it paid. A paid payout has no action left.
 */
export function PayoutActions({
  id,
  status,
}: {
  id: string;
  status: "pending" | "approved" | "paid";
}) {
  const t = useTranslations("admin.promoCodes.payouts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<Exclude<PayoutResult, { ok: true }>["error"] | null>(null);
  if (status === "paid") return null;

  const move = (to: "pending" | "approved" | "paid") =>
    startTransition(async () => {
      setProblem(null);
      const result = await setPayoutStatus(id, to).catch((): PayoutResult => ({
        ok: false,
        error: "failed",
      }));
      if (result.ok) router.refresh();
      else setProblem(result.error);
    });

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {status === "pending" ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => move("approved")}
          data-testid="payout-approve"
        >
          {t("approve")}
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => move("pending")}
          >
            {t("unapprove")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => move("paid")}
            data-testid="payout-paid"
          >
            {t("markPaid")}
          </Button>
        </>
      )}
      {problem && (
        <span role="alert" className="w-full text-right text-xs text-pink">
          {t(`errors.${problem}`)}
        </span>
      )}
    </div>
  );
}
