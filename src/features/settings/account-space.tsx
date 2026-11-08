"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile, useUpdateProfile } from "@/features/account/queries";
import { qrPath } from "@/features/invoices/document/qr";
import { AvatarEditor } from "@/features/profile/avatar-editor";
import { useSaveMarks } from "./save-state";
import { SettingRow, SettingsSection } from "./ui";

/** The longest company name (profiles_company_name_length). */
export const COMPANY_NAME_MAX = 80;

/**
 * Settings → Account: the account's short id (profiles.public_id), to read
 * out, copy or show as a QR code. A company that wants to take the person on
 * finds them by it; it is not a secret and opens nothing by itself.
 */
export function PublicIdSection() {
  const t = useTranslations("settings.account.publicId");
  const profile = useProfile();
  const id = profile.public_id;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const qr = useMemo(() => (id ? qrPath(id) : null), [id]);
  if (!id) return null;

  return (
    <SettingsSection title={t("title")}>
      <SettingRow id="settings-public-id" label={t("label")} hint={t("hint")} group layout="stack">
        <div
          id="settings-public-id"
          tabIndex={-1}
          className="flex flex-col items-start gap-4 rounded-xl outline-none sm:flex-row sm:items-center"
        >
          {qr && (
            <svg
              role="img"
              aria-label={t("qr", { id })}
              viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
              className="size-32 shrink-0 rounded-lg bg-white p-1 text-black"
            >
              <path d={qr.d} fill="currentColor" />
            </svg>
          )}
          <div className="flex flex-col gap-3">
            <p
              data-testid="public-id"
              className="font-mono text-3xl font-semibold tracking-[0.2em] text-ink tabular-nums"
            >
              {id}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(id)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

/**
 * The company's name and logo, as the people who work in it see it in their
 * space switcher. Only in one's own space.
 */
export function CompanySection() {
  const t = useTranslations("settings.account.company");
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const marks = useSaveMarks();
  const [name, setName] = useState(profile.company_name ?? "");
  useEffect(() => setName(profile.company_name ?? ""), [profile.company_name]);

  function commit() {
    const next = name.trim().slice(0, COMPANY_NAME_MAX) || null;
    if (next === (profile.company_name ?? null)) {
      setName(profile.company_name ?? "");
      return;
    }
    void marks.run(["company_name"], () => updateProfile.mutateAsync({ company_name: next }));
  }

  return (
    <SettingsSection title={t("title")}>
      <SettingRow
        id="settings-company-name"
        label={t("name")}
        hint={t("nameHint")}
        state={marks.stateOf(["company_name"])}
        layout="stack"
      >
        <Input
          id="settings-company-name"
          value={name}
          maxLength={COMPANY_NAME_MAX}
          autoComplete="organization"
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </SettingRow>
      <SettingRow id="settings-company-logo" label={t("logo")} group layout="stack">
        <div id="settings-company-logo" tabIndex={-1} className="rounded-xl outline-none">
          <AvatarEditor kind="companyLogo" />
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
