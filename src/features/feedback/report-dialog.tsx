"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CameraIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { reportPage } from "@/features/errors/report";
import { APP_VERSION } from "@/lib/app-version";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { captureScreenshot } from "./capture-screenshot";
import { consoleEntries } from "./console-buffer";
import {
  REPORT_ENDPOINT,
  REPORT_KINDS,
  REPORT_TEXT_MAX,
  type ReportInput,
  type ReportKind,
} from "./report";

type SendState = "idle" | "sending" | "failed" | "limited" | "sent";
type ShotState = "none" | "capturing" | "failed" | "ready";

/**
 * The "Report a problem" dialog: what happened (required), what was expected,
 * the kind, and an optional screenshot the person sees before sending and can
 * remove. The page, browser class (from the request), window size, language,
 * version and the last 20 console errors go with it automatically; the
 * dialog says so.
 */
export function ReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("feedback");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="md:w-[min(100vw-32px,520px)]"
    >
      {/* Remounted on every opening: a fresh form, a fresh screenshot state. */}
      {open && <ReportForm onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("feedback");
  const locale = useLocale();
  const ids = { what: useId(), expected: useId() };
  const [kind, setKind] = useState<ReportKind>("bug");
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [shot, setShot] = useState<ShotState>("none");
  const [state, setState] = useState<SendState>("idle");
  const [touched, setTouched] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (state !== "sent") return;
    const timer = window.setTimeout(onDone, 2500);
    return () => window.clearTimeout(timer);
  }, [state, onDone]);

  async function attach() {
    setShot("capturing");
    // Let the dialog's own redraw settle before the page is drawn.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    try {
      setScreenshot(await captureScreenshot());
      setShot("ready");
    } catch {
      setScreenshot(null);
      setShot("failed");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!description.trim() || inFlight.current) return;
    inFlight.current = true;
    setState("sending");
    const body: ReportInput = {
      kind,
      description: description.trim(),
      ...(expected.trim() ? { expected: expected.trim() } : {}),
      page: reportPage(window.location.pathname),
      viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      version: APP_VERSION,
      consoleErrors: consoleEntries(),
      ...(locale === "cs" || locale === "en" ? { locale } : {}),
      ...(screenshot ? { screenshot } : {}),
    };
    try {
      const response = await fetch(REPORT_ENDPOINT, {
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
        data-testid="report-thanks"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <span className="grid size-12 place-items-center rounded-full bg-green/15 text-green">
          <CheckIcon aria-hidden className="size-6" />
        </span>
        <p className="text-sm text-pretty text-ink">{t("thanks")}</p>
      </div>
    );
  }

  const sending = state === "sending";
  const missing = touched && !description.trim();
  return (
    <form onSubmit={send} className="flex flex-col gap-4" noValidate data-testid="report-form">
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
          autoFocus
          value={description}
          maxLength={REPORT_TEXT_MAX}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t(`whatPlaceholder.${kind}`, { appName: APP_NAME })}
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
          placeholder={t("expectedPlaceholder")}
          disabled={sending}
          className="min-h-16"
        />
      </div>

      <div className="flex flex-col gap-2">
        {screenshot ? (
          <figure className="flex flex-col gap-2" data-testid="report-screenshot">
            {/* A data URL of the person's own screen: next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshot}
              alt={t("screenshotAlt")}
              className="max-h-48 w-full rounded-xl border border-line object-contain object-top"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={() => {
                setScreenshot(null);
                setShot("none");
              }}
              className="self-start"
            >
              <Trash2Icon aria-hidden />
              {t("screenshotRemove")}
            </Button>
          </figure>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={sending || shot === "capturing"}
            onClick={() => void attach()}
            className="self-start"
          >
            <CameraIcon aria-hidden />
            {shot === "capturing" ? t("screenshotCapturing") : t("screenshotAttach")}
          </Button>
        )}
        {shot === "failed" && (
          <p role="alert" className="text-sm text-pink">
            {t("screenshotFailed")}
          </p>
        )}
      </div>

      <p className="text-xs text-pretty text-ink-muted">{t("autoAttached")}</p>

      {state === "failed" && <FormAlert>{t("failed")}</FormAlert>}
      {state === "limited" && <FormAlert>{t("limited")}</FormAlert>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={sending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={sending}>
          {sending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}
