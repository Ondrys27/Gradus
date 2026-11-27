"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSession, useUserSettings } from "@/features/account/queries";
import { APP_NAME } from "@/lib/constants";
import { localizedPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { useSettingsSave } from "./save-state";
import { ActionRow, DangerZone, SettingRow, SettingsPage, SettingsSection } from "./ui";

const EXPORT_URL = "/api/account/export";

/**
 * Settings → Privacy and data: whether the company sees when the user is
 * online (30.5), a copy of the account's data, the terms and the privacy
 * policy, and — at the very end, in red — deleting the account.
 */
export function PrivacyView() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const { worker } = useSession();
  const [deleting, setDeleting] = useState(false);

  return (
    <SettingsPage title={t("groups.privacy.title")} description={t("groups.privacy.description")}>
      <OnlineSection />

      <SettingsSection title={t("data.export.title")}>
        <ActionRow
          id="settings-account-export"
          label={t("data.export.label")}
          hint={worker ? t("data.export.hintWorker") : t("data.export.hint")}
          action={
            <a
              id="settings-account-export"
              data-tutorial="settings-export"
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
              data-tutorial="settings-delete-account"
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

/**
 * "Show when I am online" (on by default). Off: nobody in any company sees
 * the status, the owner neither, and the user sees nobody's; the database
 * forgets the stored moment at once.
 */
function OnlineSection() {
  const t = useTranslations("settings.data.online");
  const settings = useUserSettings();
  const { save } = useSettingsSave();
  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingRow
        id="settings-show-online"
        data-tutorial="settings-show-online"
        label={t("label")}
        hint={t("hint", { appName: APP_NAME })}
        fields={["show_online"]}
      >
        <div className="flex md:justify-end">
          <Switch
            id="settings-show-online"
            data-testid="settings-show-online"
            checked={settings.show_online}
            onCheckedChange={(checked) => save({ show_online: checked })}
          />
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
