"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { reportClientError } from "@/lib/analytics/analytics-provider";
import { scrubMessage } from "@/lib/analytics/scrub";
import { APP_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";
import { errorCodeFor } from "./error-code";
import { useMarkErrorScreen } from "./error-screen-state";
import { BUG_REPORT_DESCRIPTION_MAX, BUG_REPORT_ENDPOINT, type BugReportInput } from "./report";

/** Codes already reported from this tab: the error page never sends one twice. */
const reportedCodes = new Set<string>();

export type ErrorHome = "app" | "admin" | "site";

type ErrorScreenProps = {
  error: Error & { digest?: string };
  onRetry: () => void;
  /** Where the link under the buttons leads, and what it says. */
  home: ErrorHome;
  homeHref: string;
  /** The website sets its headings in its own face. */
  display?: boolean;
  className?: string;
};

/**
 * What a person sees when a page breaks: an apology, the error's code (to
 * copy, and to find the error in the administration), Try again, Send
 * feedback (one report per code, with an optional note) and a way home.
 * The error is recorded as client_error with the same code. Jarvis stays away
 * while it is on screen.
 */
export function ErrorScreen({
  error,
  onRetry,
  home,
  homeHref,
  display = false,
  className,
}: ErrorScreenProps) {
  const t = useTranslations("errorPage");
  const code = errorCodeFor(error);
  useMarkErrorScreen();

  useEffect(() => reportClientError(error, "boundary", code), [error, code]);

  return (
    <div className={cn("flex w-full justify-center px-0 py-10 md:py-16", className)}>
      <section
        aria-labelledby="error-page-title"
        className="flex w-full max-w-lg flex-col items-center gap-5 rounded-card border border-line bg-surface px-5 py-8 text-center shadow-glow sm:px-8"
      >
        <div className="grid size-14 place-items-center rounded-2xl border border-pink/30 bg-pink/12 text-pink [&_svg]:size-6">
          <TriangleAlertIcon aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <h1
            id="error-page-title"
            className={cn(
              "text-xl font-semibold text-balance text-ink sm:text-2xl",
              display && "font-display tracking-tight",
            )}
          >
            {t("title")}
          </h1>
          <p className="text-sm text-pretty text-ink-muted">{t("description")}</p>
        </div>

        <ErrorCode code={code} />

        {/* Keyed by the code: a new error starts with a fresh form. */}
        <ErrorActions key={code} code={code} error={error} onRetry={onRetry} />

        <a
          href={homeHref}
          className="inline-flex min-h-11 items-center text-sm text-ink-soft underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8"
        >
          {t(`home.${home}`)}
        </a>
      </section>
    </div>
  );
}

function ErrorCode({ code }: { code: string }) {
  const t = useTranslations("errorPage");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is selectable, so it can be copied by hand.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-line bg-canvas/60 px-3 py-1.5 text-sm">
      <span className="text-ink-muted">{t("codeLabel")}</span>
      <code data-testid="error-code" className="font-mono font-semibold text-ink select-all">
        {code}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-xs text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8"
      >
        {copied ? (
          <CheckIcon aria-hidden className="size-3.5 text-teal" />
        ) : (
          <CopyIcon aria-hidden className="size-3.5" />
        )}
        {copied ? t("copied") : t("copy")}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}

type FormState = "closed" | "open" | "sending" | "failed" | "sent";

/**
 * Try again and Send feedback side by side. Send feedback opens a short
 * optional note (it may be sent empty); once the report is stored, the thanks
 * take the button's place and nothing can send it again.
 */
function ErrorActions({
  code,
  error,
  onRetry,
}: {
  code: string;
  error: Error & { digest?: string };
  onRetry: () => void;
}) {
  const t = useTranslations("errorPage");
  const locale = useLocale();
  const fieldId = useId();
  const [state, setState] = useState<FormState>(() =>
    reportedCodes.has(code) ? "sent" : "closed",
  );
  const [description, setDescription] = useState("");
  const inFlight = useRef(false);

  async function send() {
    if (inFlight.current || reportedCodes.has(code)) return;
    inFlight.current = true;
    setState("sending");
    const body: BugReportInput = {
      code,
      page: window.location.pathname,
      message: scrubMessage(`${error.name}: ${error.message}`),
      viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
      version: APP_VERSION,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(error.digest && /^[A-Za-z0-9_-]{1,64}$/.test(error.digest)
        ? { digest: error.digest }
        : {}),
      ...(locale === "cs" || locale === "en" ? { locale } : {}),
    };
    try {
      const response = await fetch(BUG_REPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      reportedCodes.add(code);
      setState("sent");
    } catch {
      setState("failed");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
        <Button onClick={onRetry}>
          <RotateCcwIcon aria-hidden />
          {t("retry")}
        </Button>
        {state === "closed" && (
          <Button variant="outline" onClick={() => setState("open")}>
            <MessageSquareTextIcon aria-hidden />
            {t("feedback")}
          </Button>
        )}
      </div>

      {state === "sent" && (
        <p
          role="status"
          data-testid="error-feedback-thanks"
          className="w-full rounded-xl border border-green/30 bg-green/10 px-4 py-3 text-sm text-pretty text-ink"
        >
          {t("thanks")}
        </p>
      )}

      {(state === "open" || state === "sending" || state === "failed") && (
        <form
          className="flex w-full flex-col gap-2 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Label htmlFor={fieldId}>{t("feedbackLabel")}</Label>
          <Textarea
            id={fieldId}
            autoFocus
            value={description}
            maxLength={BUG_REPORT_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("feedbackPlaceholder")}
            disabled={state === "sending"}
          />
          {state === "failed" && (
            <p role="alert" className="text-sm text-pink">
              {t("failed")}
            </p>
          )}
          <Button type="submit" disabled={state === "sending"} className="self-stretch sm:self-end">
            {state === "sending" ? t("sending") : t("send")}
          </Button>
        </form>
      )}
    </>
  );
}
