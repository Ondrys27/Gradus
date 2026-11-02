"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { SubscriptionActionError, useCancelSubscription } from "./queries";
import { CANCEL_NOTE_MAX, CANCEL_REASONS, type CancelReason } from "./state";

/**
 * Cancelling for the end of the period: why (a reason, required, and a note,
 * optional), what happens then (read-only, nothing deleted), confirmation.
 */
export function CancelDialog({
  open,
  onOpenChange,
  endsAt,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The end of the period, formatted. */
  endsAt: string;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("subscription");
  const cancel = useCancelSubscription();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState("");
  const [missingReason, setMissingReason] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setNote("");
      setMissingReason(false);
      setError(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reason) {
      setMissingReason(true);
      return;
    }
    cancel.mutate(
      { reason, note: note.slice(0, CANCEL_NOTE_MAX) },
      {
        onSuccess: () => {
          close(false);
          onDone(t("notices.cancelled", { date: endsAt }));
        },
        onError: (failure) =>
          setError(
            t(`errors.${failure instanceof SubscriptionActionError ? failure.code : "unknown"}`),
          ),
      },
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={t("cancel.title")}
      closeLabel={t("cancel.close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="subscription-cancel">
        <p className="text-sm text-ink-soft">{t("cancel.text", { date: endsAt })}</p>

        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={missingReason ? "cancel-reason-message" : undefined}
        >
          <legend className="mb-2 text-sm font-medium text-ink">{t("cancel.reasonLabel")}</legend>
          {CANCEL_REASONS.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink-soft",
                "has-[:checked]:border-violet has-[:checked]:text-ink has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name="cancel-reason"
                value={option}
                checked={reason === option}
                onChange={() => {
                  setReason(option);
                  setMissingReason(false);
                }}
                className="size-4 accent-violet"
              />
              {t(`cancel.reasons.${option}`)}
            </label>
          ))}
          {missingReason && (
            <p id="cancel-reason-message" className="text-xs text-pink" aria-live="polite">
              {t("errors.reasonRequired")}
            </p>
          )}
        </fieldset>

        <FormField id="cancel-note" label={t("cancel.noteLabel")} hint={t("cancel.noteHint")}>
          <Textarea
            {...fieldA11y("cancel-note", undefined, true)}
            value={note}
            rows={3}
            maxLength={CANCEL_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>

        {error && <FormAlert>{error}</FormAlert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => close(false)} disabled={cancel.isPending}>
            {t("cancel.keep")}
          </Button>
          <Button type="submit" variant="destructive" disabled={cancel.isPending}>
            {t("cancel.confirm")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
