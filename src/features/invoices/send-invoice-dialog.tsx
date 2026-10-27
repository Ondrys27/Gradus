"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useSession } from "@/features/account/queries";
import { formatCalendarDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { errorCodeOf } from "./errors";
import { useSendInvoice, type InvoiceWithLinks } from "./queries";
import { fieldErrors, invoiceEmailSchema } from "./schemas";

/** "Send by e-mail": the PDF attached, the text prefilled, a copy to the user. */
export function SendInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  total,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceWithLinks;
  total: string;
  onSent: () => void;
}) {
  const t = useTranslations("invoices.send");
  const tErrors = useTranslations("invoices.fieldErrors");
  const tFailure = useTranslations("finance.invoiceErrors");
  const settings = useFormatSettings();
  const { user } = useSession();
  const send = useSendInvoice();
  const supplier = invoice.supplier?.name ?? "";
  const values = {
    number: invoice.number ?? "",
    total,
    due: invoice.due_on ? formatCalendarDate(invoice.due_on, settings) : "—",
    supplier,
  };
  const credit = invoice.kind === "credit_note";
  const [to, setTo] = useState(invoice.customer.email ?? "");
  const [subject, setSubject] = useState(() => t(credit ? "subjectCredit" : "subject", values));
  const [body, setBody] = useState(() => t(credit ? "bodyCredit" : "body", values));
  const [ccSelf, setCcSelf] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { invoiceId: invoice.id, to: to.trim(), subject, body, ccSelf };
    const parsed = invoiceEmailSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await send.mutateAsync(input);
      onSent();
    } catch {
      // Shown in the dialog.
    }
  }

  const error = (key: string) => {
    const code = errors[key];
    if (!code) return undefined;
    return tErrors.has(code) ? tErrors(code) : tErrors("invalid");
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("title")} closeLabel={t("close")} className="w-[min(100vw-32px,560px)]">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField id="invoice-send-to" label={t("to")} error={error("to")}>
          <Input id="invoice-send-to" type="email" value={to} autoComplete="email" onChange={(event) => setTo(event.target.value)} />
        </FormField>
        <FormField id="invoice-send-subject" label={t("subjectLabel")} error={error("subject")}>
          <Input id="invoice-send-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
        </FormField>
        <FormField id="invoice-send-body" label={t("bodyLabel")} error={error("body")}>
          <Textarea id="invoice-send-body" value={body} rows={8} maxLength={5000} onChange={(event) => setBody(event.target.value)} />
        </FormField>
        <p className="text-xs text-ink-muted">{t("attachment", { number: values.number })}</p>
        {user.email && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <Checkbox checked={ccSelf} onCheckedChange={(checked) => setCcSelf(checked === true)} />
            {t("ccSelf", { email: user.email })}
          </label>
        )}
        {send.isError && <FormAlert>{tFailure(errorCodeOf(send.error))}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={send.isPending}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
