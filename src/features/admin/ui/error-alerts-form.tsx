"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, MailIcon, PlusIcon, SendIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  DIGEST_MINUTES_MAX,
  DIGEST_MINUTES_MIN,
  ERROR_ALERT_MODES,
  normalizeAlertEmail,
  type ErrorAlertFormProblem,
  type ErrorAlertMode,
  type ErrorAlertSettings,
} from "@/features/errors/alerts/settings";
import { cn } from "@/lib/utils";
import {
  saveErrorAlerts,
  sendErrorAlertsTest,
  type ErrorAlertsSaveResult,
  type ErrorAlertsTestResult,
} from "../server/error-alerts-actions";

type AddProblem = "invalid" | "duplicate" | "tooMany";

/**
 * Where the error e-mails go: the list of addresses (add, remove, at most
 * `maxEmails`), every error on its own or a summary every N minutes, and a
 * test e-mail to the saved addresses. An admin sees the same without controls.
 */
export function ErrorAlertsForm({
  saved,
  readOnly,
  maxEmails,
  digestHourUtc,
  updated,
}: {
  saved: ErrorAlertSettings;
  readOnly: boolean;
  maxEmails: number;
  digestHourUtc: number;
  /** "Changed 27. 10. 2026 14:03 by …", or null. */
  updated: string | null;
}) {
  const t = useTranslations("admin.errorAlerts");
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>(saved.emails);
  const [draft, setDraft] = useState("");
  const [addProblem, setAddProblem] = useState<AddProblem | null>(null);
  const [mode, setMode] = useState<ErrorAlertMode>(saved.mode);
  const [minutes, setMinutes] = useState(String(saved.digest_minutes));
  const [problems, setProblems] = useState<ErrorAlertFormProblem[]>([]);
  const [saveState, setSaveState] = useState<
    "saved" | Exclude<ErrorAlertsSaveResult, { ok: true }>["error"] | null
  >(null);
  const [test, setTest] = useState<ErrorAlertsTestResult | null>(null);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();

  const dirty =
    emails.join(",") !== saved.emails.join(",") ||
    mode !== saved.mode ||
    (mode === "digest" && minutes.trim() !== String(saved.digest_minutes));
  const full = emails.length >= maxEmails;

  if (readOnly) {
    return (
      <div className="flex flex-col gap-4" data-testid="error-alerts-readonly">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
          <dt className="text-ink-soft">{t("emailsLabel")}</dt>
          <dd className="min-w-0 break-words text-ink">
            {saved.emails.length ? saved.emails.join(", ") : t("noEmails")}
          </dd>
          <dt className="text-ink-soft">{t("modeLabel")}</dt>
          <dd className="text-ink">
            {saved.mode === "every"
              ? t("modes.every")
              : t("modes.digest", { minutes: saved.digest_minutes })}
          </dd>
        </dl>
        <p className="text-xs text-ink-muted">{t("readOnly")}</p>
        {updated && <p className="text-xs text-ink-muted">{updated}</p>}
      </div>
    );
  }

  function add(event?: FormEvent) {
    event?.preventDefault();
    setSaveState(null);
    const email = normalizeAlertEmail(draft);
    if (!email) return setAddProblem("invalid");
    if (emails.includes(email)) return setAddProblem("duplicate");
    if (full) return setAddProblem("tooMany");
    setEmails((current) => [...current, email]);
    setDraft("");
    setAddProblem(null);
  }

  function remove(email: string) {
    setSaveState(null);
    setEmails((current) => current.filter((item) => item !== email));
  }

  function save() {
    setSaveState(null);
    setTest(null);
    startSaving(async () => {
      const result = await saveErrorAlerts({ emails, mode, digestMinutes: minutes }).catch(
        (): ErrorAlertsSaveResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblems(result.problems ?? []);
        setSaveState(result.error);
        return;
      }
      setProblems([]);
      setSaveState("saved");
      router.refresh();
    });
  }

  function sendTest() {
    setTest(null);
    startTesting(async () => {
      setTest(
        await sendErrorAlertsTest().catch((): ErrorAlertsTestResult => ({
          ok: false,
          error: "failed",
        })),
      );
    });
  }

  const minutesError = problems.includes("digestMinutes")
    ? t("errors.digestMinutes", { min: DIGEST_MINUTES_MIN, max: DIGEST_MINUTES_MAX })
    : undefined;

  return (
    <div className="flex flex-col gap-6" data-testid="error-alerts-form">
      <section className="flex flex-col gap-3" aria-labelledby="error-alerts-emails">
        <h3 id="error-alerts-emails" className="text-sm font-semibold text-ink">
          {t("emailsLabel")}
        </h3>
        {emails.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noEmails")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="error-alerts-emails">
            {emails.map((email) => (
              <li
                key={email}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-canvas-deep/40 py-1 pr-1 pl-3"
              >
                <MailIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{email}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove", { email })}
                  onClick={() => remove(email)}
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <FormField
            id="error-alerts-new"
            label={<span className="sr-only">{t("addLabel")}</span>}
            className="flex-1"
            error={addProblem ? t(`errors.add.${addProblem}`, { max: maxEmails }) : undefined}
            hint={full ? t("full", { max: maxEmails }) : t("addHint", { max: maxEmails })}
          >
            <Input
              {...fieldA11y("error-alerts-new", addProblem, true)}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("addPlaceholder")}
              value={draft}
              disabled={full}
              onChange={(event) => {
                setDraft(event.target.value);
                setAddProblem(null);
              }}
            />
          </FormField>
          <Button type="submit" variant="outline" disabled={full || !draft.trim()}>
            <PlusIcon aria-hidden />
            {t("add")}
          </Button>
        </form>
        {problems.some((problem) => problem !== "digestMinutes") && (
          <FormAlert>{t("errors.emails")}</FormAlert>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="error-alerts-mode">
        <h3 id="error-alerts-mode" className="text-sm font-semibold text-ink">
          {t("modeLabel")}
        </h3>
        <div
          role="radiogroup"
          aria-labelledby="error-alerts-mode"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {ERROR_ALERT_MODES.map((value) => {
            const checked = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  setMode(value);
                  setSaveState(null);
                }}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-center text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  checked
                    ? "border-violet/60 bg-violet/15 text-ink"
                    : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
                )}
              >
                {checked && <CheckIcon aria-hidden className="size-3.5 shrink-0 text-violet" />}
                {value === "every" ? t("modes.every") : t("modes.digestOption")}
              </button>
            );
          })}
        </div>
        {mode === "digest" && (
          <FormField
            id="error-alerts-minutes"
            label={t("minutesLabel")}
            error={minutesError}
            hint={t("minutesHint", { min: DIGEST_MINUTES_MIN, max: DIGEST_MINUTES_MAX })}
            className="max-w-xs"
          >
            <Input
              {...fieldA11y("error-alerts-minutes", minutesError, true)}
              inputMode="numeric"
              autoComplete="off"
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
                setSaveState(null);
              }}
            />
          </FormField>
        )}
        <p className="text-xs text-pretty text-ink-muted">
          {mode === "every"
            ? t("modeHint.every")
            : t("modeHint.digest", { minutes: minutes.trim() || "N", hour: digestHourUtc })}
        </p>
      </section>

      {saveState === "saved" && <FormAlert tone="success">{t("saved")}</FormAlert>}
      {saveState && saveState !== "saved" && <FormAlert>{t(`errors.${saveState}`)}</FormAlert>}
      {test && (
        <div data-testid="error-alerts-test-result">
          {test.ok ? (
            test.sent === test.total ? (
              <FormAlert tone="success">{t("test.sent", { count: test.sent })}</FormAlert>
            ) : (
              <FormAlert>
                {t("test.partial", { sent: test.sent, total: test.total })}
                {test.failure && (
                  <span className="mt-1 block text-xs break-words">{test.failure}</span>
                )}
              </FormAlert>
            )
          ) : (
            <FormAlert>{t(`test.errors.${test.error}`)}</FormAlert>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            onClick={sendTest}
            disabled={testing || dirty || saved.emails.length === 0}
          >
            <SendIcon aria-hidden />
            {testing ? t("test.sending") : t("test.button")}
          </Button>
          {dirty && <span className="text-xs text-ink-muted">{t("test.saveFirst")}</span>}
        </div>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? t("saving") : t("save")}
          </Button>
          {updated && <span className="text-xs text-ink-muted">{updated}</span>}
        </div>
      </div>
    </div>
  );
}
