"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/account/workspace-queries";
import { InvoiceDetail } from "./invoice-detail";
import { InvoiceEditor, INVOICES_PATH } from "./invoice-editor";
import { useInvoice, useInvoiceProfile } from "./queries";
import { InvoiceSetupGate } from "./setup-wizard";

/**
 * /app/finance/faktury/nova and /app/finance/faktury/[id]: a draft opens in
 * the editor, an issued invoice in its detail. Without the supplier's details
 * the guide comes first.
 */
export function InvoicePage({ id }: { id: string | null }) {
  const t = useTranslations("invoices.page");
  const canEdit = useCan("finance", "edit");
  const canView = useCan("finance", "view");
  const profile = useInvoiceProfile();
  const invoice = useInvoice(id);

  if (!canView) return <EmptyState title={t("noAccess")} description={t("noAccessHint")} />;
  if (profile.isError || invoice.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (profile.isPending || (id && invoice.isPending)) {
    return (
      <div className="flex flex-col gap-4" aria-hidden>
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (id && !invoice.data) {
    return (
      <EmptyState
        title={t("notFound")}
        description={t("notFoundHint")}
        action={
          <Link href={INVOICES_PATH} className={buttonVariants({ variant: "secondary" })}>
            {t("backToList")}
          </Link>
        }
      />
    );
  }

  const record = invoice.data ?? null;
  if (record && record.status !== "draft") return <InvoiceDetail invoice={record} profile={profile.data} />;
  if (!canEdit) return <EmptyState title={t("readOnly")} description={t("readOnlyHint")} />;
  if (!profile.data) return <InvoiceSetupGate />;
  return <InvoiceEditor key={record?.id ?? "new"} record={record} profile={profile.data} />;
}
