"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { SettingsSection } from "@/features/settings/ui";
import { APP_NAME } from "@/lib/constants";

/**
 * "How to connect to Claude" (28.8), step by step with a small drawing of
 * each screen (drawn from the app's tokens, not a screenshot of Claude, so
 * it never goes stale with their design).
 */
export function ConnectSteps({ serverUrl }: { serverUrl: string }) {
  const t = useTranslations("mcp.steps");
  const steps: Array<{ key: string; picture: ReactNode }> = [
    {
      key: "settings",
      picture: (
        <Frame>
          <Row muted>{t("pictures.profile")}</Row>
          <Row highlight>
            <SettingsIcon aria-hidden className="size-3" />
            {t("pictures.settings")}
          </Row>
          <Row highlight>{t("pictures.connectors")}</Row>
        </Frame>
      ),
    },
    {
      key: "add",
      picture: (
        <Frame>
          <Row muted>{t("pictures.connectors")}</Row>
          <Row highlight>
            <PlusIcon aria-hidden className="size-3" />
            {t("pictures.addCustom")}
          </Row>
        </Frame>
      ),
    },
    {
      key: "paste",
      picture: (
        <Frame>
          <Field label={t("pictures.name")} value={APP_NAME} />
          <Field label={t("pictures.url")} value={serverUrl} mono />
          <Row highlight>{t("pictures.addButton")}</Row>
        </Frame>
      ),
    },
    {
      key: "connect",
      picture: (
        <Frame>
          <Row muted>{APP_NAME}</Row>
          <Row highlight>{t("pictures.connect")}</Row>
          <Row muted>{t("pictures.consent", { appName: APP_NAME })}</Row>
        </Frame>
      ),
    },
  ];
  return (
    <SettingsSection
      id="settings-mcp-steps"
      title={t("title")}
      description={t("hint")}
    >
      <ol className="grid gap-4 py-4 first:pt-0 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-col gap-2 rounded-2xl border border-line p-3">
            <div aria-hidden>{step.picture}</div>
            <p className="text-sm text-ink">
              <span className="mr-1.5 font-semibold text-violet">{index + 1}.</span>
              {t(`items.${step.key}`, { appName: APP_NAME })}
            </p>
          </li>
        ))}
      </ol>
      <p className="py-3 text-xs text-ink-muted">{t("teams")}</p>
    </SettingsSection>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-canvas-deep p-2.5">
      <div className="mb-1 flex gap-1">
        <span className="size-1.5 rounded-full bg-line-strong" />
        <span className="size-1.5 rounded-full bg-line-strong" />
        <span className="size-1.5 rounded-full bg-line-strong" />
      </div>
      {children}
    </div>
  );
}

function Row({
  children,
  highlight,
  muted,
}: {
  children: ReactNode;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "flex items-center gap-1.5 rounded-lg border border-violet/60 bg-violet/15 px-2 py-1 text-[11px] text-ink"
          : muted
            ? "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-ink-muted"
            : "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-ink-soft"
      }
    >
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <span className="text-[10px] text-ink-muted">{label}</span>
      <span
        className={`truncate rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
