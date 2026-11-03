"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useSession } from "@/features/account/queries";
import { localizedPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ActionRow, DangerZone, SettingsPage, SettingsSection } from "./ui";

const EXPORT_URL = "/api/account/export";

/**
 * Settings → Privacy and data: a copy of the account's data, the terms and
 * the privacy policy, and — at the very end, in red — deleting the account.
 */
export function PrivacyView() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const { worker } = useSession();
  const [deleting, setDeleting] = useState(false);

  return (
    <SettingsPage title={t("groups.privacy.title")} description={t("groups.privacy.description")}>
      <SettingsSection title={t("data.export.title")}>
        <ActionRow
          id="settings-account-export"
          label={t("data.export.label")}
          hint={worker ? t("data.export.hintWorker") : t("data.export.hint")}
          action={
            <a
              id="settings-account-export"
              href={EXPORT_URL}
              download
              className={buttonVariants({ variant: "secondary" })}
            >
              <DownloadIcon aria-hidden />
              {t("data.export.action")}
            </a>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("data.legal.title")} description={t("data.legal.description")}>
        <ActionRow
          id="settings-legal"
          label={t("data.legal.label")}
          action={
            <div id="settings-legal" tabIndex={-1} className="flex flex-wrap gap-2 rounded-xl outline-none">
              <Link
                href={localizedPath("terms", locale)}
                target="_blank"
                rel="noopener"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                {t("data.legal.terms")}
                <ExternalLinkIcon aria-hidden className="size-3.5" />
              </Link>
              <Link
                href={localizedPath("privacy", locale)}
                target="_blank"
                rel="noopener"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                {t("data.legal.privacy")}
                <ExternalLinkIcon aria-hidden className="size-3.5" />
              </Link>
            </div>
          }
        />
      </SettingsSection>

      <DangerZone title={t("data.danger.title")} description={t("data.danger.description")}>
        <ActionRow
          id="settings-account-delete"
          label={t("data.delete.label")}
          hint={t("data.delete.hint")}
          action={
            <Button
              id="settings-account-delete"
              variant="destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2Icon aria-hidden />
              {t("data.delete.action")}
            </Button>
          }
        />
      </DangerZone>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </SettingsPage>
  );
}
