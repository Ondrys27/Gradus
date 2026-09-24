"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { lostReasonSchema, REASON_MAX } from "./schemas";
import type { Deal } from "./types";

type Props = {
  /** The deal about to be marked lost; the dialog is open while there is one. */
  deal: Deal | null;
  onCancel: () => void;
  onConfirm: (deal: Deal, reason: string) => void;
};

/** A lost deal asks why. The answer is optional, so a drop is never blocked by it. */
export function LostReasonDialog({ deal, onCancel, onConfirm }: Props) {
  const t = useTranslations("pipeline.lost");
  const generation = useFreshOnOpen(deal !== null);

  return (
    <ResponsiveDialog
      open={deal !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("title")}
      closeLabel={t("close")}
    >
      {deal && (
        <ReasonForm
          key={generation}
          deal={deal}
          onCancel={onCancel}
          onConfirm={(reason) => onConfirm(deal, reason)}
        />
      )}
    </ResponsiveDialog>
  );
}

function ReasonForm({
  deal,
  onCancel,
  onConfirm,
}: {
  deal: Deal;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("pipeline");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = lostReasonSchema.safeParse(reason);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    onConfirm(parsed.data);
  }

  const error = invalid ? t("errors.reasonTooLong") : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">{t("lost.description", { title: deal.title })}</p>
      <FormField id="lost-reason" label={t("lost.reason")} error={error} hint={t("lost.hint")}>
        <Textarea
          {...fieldA11y("lost-reason", error, true)}
          value={reason}
          maxLength={REASON_MAX + 50}
          placeholder={t("lost.placeholder")}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("lost.cancel")}
        </Button>
        <Button type="submit">{t("lost.confirm")}</Button>
      </div>
    </form>
  );
}
