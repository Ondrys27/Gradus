"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { CheckIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Label, Textarea } from "@/components/ui/input";
import { REPORT_KINDS, REPORT_TEXT_MAX, type ReportKind } from "@/features/feedback/report";
import { SUPPORT_ENDPOINT, type SupportInput } from "@/features/feedback/support";
import { cn } from "@/lib/utils";

type SendState = "idle" | "sending" | "failed" | "limited" | "sent";

/**
 * The support form: what happened (required), what was expected, the kind
 * and an e-mail to be answered at. Into the same reports as "Report a
 * problem" in the app; the server knows a signed-in sender by the session.
 */
export function SupportForm() {
  const t = useTranslations("marketing.support");
  const locale = useLocale();
  const ids = { what: useId(), expected: useId(), email: useId(), website: useId() };
  const [kind, setKind] = useState<ReportKind>("bug");
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [touched, setTouched] = useState(false);
  const inFlight = useRef(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!description.trim() || inFlight.current) return;
    inFlight.current = true;
    setState("sending");
    const body: SupportInput = {
      kind,
      description: description.trim(),
      ...(expected.trim() ? { expected: expected.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(locale === "cs" || locale === "en" ? { locale } : {}),
      viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      ...(website ? { website } : {}),
    };
    try {
      const response = await fetch(SUPPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (response.status === 429) setState("limited");
      else if (!response.ok) setState("failed");
      else setState("sent");
    } catch {
      setState("failed");
    } finally {
      inFlight.current = false;
    }
  }

  if (state === "sent") {
    return (
      <div
        role="status"
        data-testid="support-thanks"
        className="flex flex-col items-center gap-3 rounded-card border border-green/40 bg-green/10 p-8 text-center"
      >
        <span className="grid size-12 place-items-center rounded-full bg-green/15 text-green">
          <CheckIcon aria-hidden className="size-6" />
        </span>
        <p className="text-pretty text-ink">{t("thanks")}</p>
      </div>
    );
  }

  const sending = state === "sending";
  const missing = touched && !description.trim();
  return (
    <form onSubmit={send} className="flex flex-col gap-5" noValidate data-testid="support-form">
      <fieldset className="flex flex-col gap-2" disabled={sending}>
        <legend className="mb-1 text-sm font-medium text-ink-soft">{t("kindLabel")}</legend>
        <div role="radiogroup" aria-label={t("kindLabel")} className="grid grid-cols-3 gap-1.5">
          {REPORT_KINDS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "min-h-11 cursor-pointer rounded-xl border px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                kind === value
                  ? "border-violet/60 bg-violet/20 text-ink"
                  : "border-line bg-canvas-deep/40 text-ink-soft hover:text-ink",
              )}
            >
              {t(`kind.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.what}>{t("whatLabel")}</Label>
        <Textarea
          id={ids.what}
          value={description}
          maxLength={REPORT_TEXT_MAX}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("whatPlaceholder")}
          disabled={sending}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${ids.what}-error` : undefined}
          required
        />
        {missing && (
          <p id={`${ids.what}-error`} role="alert" className="text-sm text-pink">
            {t("whatRequired")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.expected}>{t("expectedLabel")}</Label>
        <Textarea
          id={ids.expected}
          value={expected}
          maxLength={REPORT_TEXT_MAX}
          onChange={(event) => setExpected(event.target.value)}
          disabled={sending}
          className="min-h-16"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.email}>{t("emailLabel")}</Label>
        <Input
          id={ids.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
          disabled={sending}
          aria-describedby={`${ids.email}-hint`}
        />
        <p id={`${ids.email}-hint`} className="text-xs text-ink-muted">
          {t("emailHint")}
        </p>
      </div>

      {/* Hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={ids.website}>Website</label>
        <input
          id={ids.website}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {state === "failed" && <FormAlert>{t("failed")}</FormAlert>}
      {state === "limited" && <FormAlert>{t("limited")}</FormAlert>}
      <Button type="submit" disabled={sending} className="self-end" data-testid="support-send">
        {sending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}
