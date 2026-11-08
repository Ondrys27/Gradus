"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CheckCircle2Icon, TicketPercentIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  checkPromoCode,
  redeemPromoCode,
  type PromoActionProblem,
  type PromoRedeemResult,
} from "./actions";
import {
  isPromoCode,
  normalizePromoCode,
  PROMO_CODE_MAX,
  PROMO_CODE_MIN,
  type PromoBenefit,
} from "./codes";

/** Waits this long after the last key before asking the server about the code. */
const CHECK_DELAY_MS = 400;

export type PromoOfferView = { code: string } & PromoBenefit;

/** "first month at half price", "trial 14 days longer"… in the UI's language. */
export function usePromoBenefitText() {
  const t = useTranslations("promo.benefit");
  return (offer: PromoBenefit) => t(offer.benefit, { value: offer.value });
}

/** "Code XYZ: first month at half price". */
export function usePromoOfferText() {
  const t = useTranslations("promo");
  const benefit = usePromoBenefitText();
  return (offer: PromoOfferView) => t("offer", { code: offer.code, benefit: benefit(offer) });
}

type Verdict =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; offer: PromoOfferView }
  | { kind: "problem"; problem: PromoActionProblem };

/**
 * The checked value of a code field: idle while empty or too short to be a
 * code, a problem at once when it cannot be one, otherwise what the server
 * says a moment after the last key.
 */
function useVerdict(value: string): Verdict {
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const latest = useRef(0);
  const code = normalizePromoCode(value);

  useEffect(() => {
    const ask = ++latest.current;
    // Empty, or still being typed: nothing to say yet.
    if (!code || (code.length < PROMO_CODE_MIN && /^[A-Z0-9]*$/.test(code))) {
      setVerdict({ kind: "idle" });
      return;
    }
    if (!isPromoCode(code)) {
      setVerdict({ kind: "problem", problem: "invalid" });
      return;
    }
    setVerdict({ kind: "checking" });
    const timer = window.setTimeout(async () => {
      const result = await checkPromoCode(code).catch(() => ({
        ok: false as const,
        problem: "unavailable" as const,
      }));
      if (ask !== latest.current) return;
      setVerdict(
        result.ok
          ? {
              kind: "ok",
              offer: {
                code: result.offer.code,
                benefit: result.offer.benefit,
                value: result.offer.value,
              },
            }
          : { kind: "problem", problem: result.problem },
      );
    }, CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [code]);

  return verdict;
}

/** The line under the field: what the code gives, or why it cannot be used. */
export function PromoVerdictLine({ verdict, id }: { verdict: Verdict; id: string }) {
  const t = useTranslations("promo");
  const offerText = usePromoOfferText();
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      data-testid="promo-verdict"
      className={cn(
        "min-h-4 text-xs",
        verdict.kind === "ok" && "flex items-center gap-1.5 font-medium text-teal",
        verdict.kind === "problem" && "text-pink",
        verdict.kind === "checking" && "text-ink-muted",
      )}
    >
      {verdict.kind === "ok" && <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0" />}
      {verdict.kind === "ok"
        ? offerText(verdict.offer)
        : verdict.kind === "problem"
          ? t(`problems.${verdict.problem}`)
          : verdict.kind === "checking"
            ? t("field.checking")
            : ""}
    </p>
  );
}

/**
 * „Máš kód?" in the registration form: a quiet link that opens the field
 * (open from the start when a partner's link prefilled it). The code goes
 * with the form as `name`; the server checks it again before the account
 * is made.
 */
export function PromoCodeField({
  name,
  defaultValue = "",
  serverProblem,
}: {
  name: string;
  defaultValue?: string;
  /** What the server said when the form was sent. */
  serverProblem?: PromoActionProblem;
}) {
  const t = useTranslations("promo.field");
  const id = useId();
  const [open, setOpen] = useState(Boolean(defaultValue) || Boolean(serverProblem));
  const [value, setValue] = useState(defaultValue);
  const verdict = useVerdict(value);
  const shown: Verdict =
    serverProblem && normalizePromoCode(value) === normalizePromoCode(defaultValue)
      ? { kind: "problem", problem: serverProblem }
      : verdict;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-ink-soft underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
        data-testid="promo-toggle"
      >
        <TicketPercentIcon aria-hidden className="size-4" />
        {t("toggle")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-input`}>{t("label")}</Label>
      <Input
        id={`${id}-input`}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={PROMO_CODE_MAX + 8}
        aria-describedby={`${id}-verdict`}
        aria-invalid={shown.kind === "problem" || undefined}
        autoFocus={!defaultValue}
        className="uppercase"
        data-testid="promo-input"
      />
      <PromoVerdictLine verdict={shown} id={`${id}-verdict`} />
    </div>
  );
}

/**
 * The field with its own „Použít kód" button, for the onboarding and Settings
 * → Subscription. The code is saved for the account right away.
 */
export function PromoRedeemForm({
  source,
  suggested,
  onRedeemed,
  startOpen = false,
}: {
  source: "signup" | "settings";
  suggested?: string | null;
  onRedeemed: (result: Extract<PromoRedeemResult, { ok: true }>) => void;
  startOpen?: boolean;
}) {
  const t = useTranslations("promo");
  const id = useId();
  const [open, setOpen] = useState(startOpen || Boolean(suggested));
  const [value, setValue] = useState(suggested ?? "");
  const [problem, setProblem] = useState<PromoActionProblem | null>(null);
  const [pending, startTransition] = useTransition();
  const verdict = useVerdict(value);
  const shown: Verdict = problem ? { kind: "problem", problem } : verdict;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-ink-soft underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
        data-testid="promo-toggle"
      >
        <TicketPercentIcon aria-hidden className="size-4" />
        {t("field.toggle")}
      </button>
    );
  }

  function apply() {
    setProblem(null);
    startTransition(async () => {
      const result = await redeemPromoCode(value, source).catch((): PromoRedeemResult => ({
        ok: false,
        problem: "unavailable",
      }));
      if (result.ok) onRedeemed(result);
      else setProblem(result.problem);
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (verdict.kind === "ok") apply();
      }}
      data-testid="promo-redeem"
    >
      <Label htmlFor={`${id}-input`}>{t("field.label")}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-input`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={PROMO_CODE_MAX + 8}
          aria-describedby={`${id}-verdict`}
          aria-invalid={shown.kind === "problem" || undefined}
          autoFocus={!suggested}
          className="uppercase sm:max-w-60"
          data-testid="promo-input"
        />
        <Button type="submit" variant="secondary" disabled={pending || verdict.kind !== "ok"}>
          {t("redeem.apply")}
        </Button>
      </div>
      <PromoVerdictLine verdict={shown} id={`${id}-verdict`} />
    </form>
  );
}
