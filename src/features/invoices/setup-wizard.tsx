"use client";

import { useState } from "react";
import { BuildingIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useWorkspace } from "@/features/account/workspace-queries";
import { InvoiceProfileForm } from "./profile-form";
import { useInvoiceProfile } from "./queries";
import type { InvoiceProfile } from "./types";

/**
 * "Before your first invoice": opens by itself the first time invoices are
 * opened while the workspace has no supplier details. The owner fills them
 * in; a worker is told the owner has to. Afterwards the details live in
 * Settings → Invoices.
 */
export function InvoiceSetupGate({ onReady }: { onReady?: (profile: InvoiceProfile) => void }) {
  const t = useTranslations("invoices.setup");
  const profile = useInvoiceProfile();
  const isOwner = useWorkspace().role === "owner";
  const [open, setOpen] = useState(true);

  if (profile.isPending || profile.isError || profile.data) return null;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-4 sm:flex-row sm:items-center">
        <BuildingIcon aria-hidden className="size-5 shrink-0 text-gold" />
        <p className="flex-1 text-sm text-ink">{isOwner ? t("banner") : t("bannerWorker")}</p>
        {isOwner && (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            {t("open")}
          </Button>
        )}
      </div>
      {isOwner && (
        <ResponsiveDialog
          open={open}
          onOpenChange={setOpen}
          title={t("title")}
          closeLabel={t("close")}
          className="w-[min(100vw-32px,640px)]"
        >
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink-soft">{t("intro")}</p>
            <InvoiceProfileForm
              profile={null}
              submitLabel={t("submit")}
              onSaved={(saved) => {
                setOpen(false);
                onReady?.(saved);
              }}
            />
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}
