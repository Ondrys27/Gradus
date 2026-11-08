"use client";

import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession, useSignOut, useUserSettings } from "@/features/account/queries";
import { AvatarEditor } from "@/features/profile/avatar-editor";
import { ChangePasswordForm } from "@/features/profile/change-password-form";
import { ProfileFields } from "@/features/profile/profile-fields";
import { locales } from "@/i18n/locales";
import { CompanySection, PublicIdSection } from "./account-space";
import { useSettingsSave } from "./save-state";
import { ActionRow, ChoiceGrid, ChoiceTile, SettingRow, SettingsPage, SettingsSection } from "./ui";

/**
 * Settings → Account: who you are in the app (photo, name, username), your
 * short id, your company's name and logo, how you sign in (e-mail,
 * password), the language, and signing out.
 */
export function AccountView() {
  const t = useTranslations("settings");
  const tProfile = useTranslations("profile");
  const { user, spaceId } = useSession();
  const settings = useUserSettings();
  const { save } = useSettingsSave();
  const signOut = useSignOut();

  return (
    <SettingsPage title={t("groups.account.title")} description={t("groups.account.description")}>
      <SettingsSection title={t("account.profileTitle")}>
        <SettingRow id="settings-avatar" label={tProfile("avatar.title")} group layout="stack">
          <div id="settings-avatar" tabIndex={-1} className="rounded-xl outline-none">
            <AvatarEditor />
          </div>
        </SettingRow>
        <ProfileFields />
      </SettingsSection>

      <PublicIdSection />
      {/* The company is the one of the own space; in somebody else's it is theirs to name. */}
      {spaceId === user.id && <CompanySection />}

      <SettingsSection title={t("account.signInTitle")}>
        <SettingRow
          id="settings-email"
          label={tProfile("details.email")}
          hint={t("account.emailHint")}
          layout="stack"
        >
          <Input id="settings-email" value={user.email} readOnly disabled />
        </SettingRow>
        <SettingRow
          id="settings-password"
          label={tProfile("password.title")}
          hint={t("account.passwordHint")}
          group
          layout="stack"
        >
          <div id="settings-password" tabIndex={-1} className="rounded-xl outline-none">
            <ChangePasswordForm />
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("language.title")}>
        <SettingRow
          id="settings-language"
          label={t("language.label")}
          fields={["locale"]}
          group
          layout="stack"
        >
          <ChoiceGrid id="settings-language" label={t("language.title")} columns={2}>
            {locales.map((code) => (
              <ChoiceTile
                key={code}
                checked={settings.locale === code}
                onSelect={() => save({ locale: code })}
                title={t(`language.options.${code}`)}
              />
            ))}
          </ChoiceGrid>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("account.sessionTitle")}>
        <ActionRow
          id="settings-sign-out"
          label={t("account.signOut.label")}
          hint={t("account.signOut.hint")}
          action={
            <Button id="settings-sign-out" variant="secondary" onClick={() => void signOut()}>
              <LogOutIcon aria-hidden />
              {t("account.signOut.action")}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPage>
  );
}
