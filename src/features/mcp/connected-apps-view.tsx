"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  PencilLineIcon,
  PlugIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/features/account/workspace-queries";
import { ChoiceTile, SettingsPage, SettingsSection } from "@/features/settings/ui";
import { APP_NAME } from "@/lib/constants";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { ConnectSteps } from "./connect-steps";
import { MCP_LEVELS, type McpLevel } from "./levels";
import {
  McpActionError,
  useConnectedAppCalls,
  useConnectedAppCounts,
  useConnectedApps,
  useDisconnectApp,
  useMySpaceNames,
  useRestoreFromTrash,
  useSetAppLevel,
  useTrash,
  useTrashRetention,
  type ConnectedApp,
} from "./queries";

const LEVEL_ICONS = { read: BookOpenIcon, write: PencilLineIcon, full: ShieldAlertIcon } as const;

/**
 * Settings → Integrations (28.8): the address of the Gradus MCP server, how
 * to add it to Claude, the connected apps (level, companies, when, how many
 * actions, their history, Disconnect) and the trash of what Grady and the
 * apps deleted.
 */
export function ConnectedAppsView({ serverUrl }: { serverUrl: string }) {
  const t = useTranslations("settings");
  return (
    <SettingsPage
      title={t("groups.integrations.title")}
      description={t("groups.integrations.description", { appName: APP_NAME })}
    >
      <ServerAddress serverUrl={serverUrl} />
      <ConnectSteps serverUrl={serverUrl} />
      <Apps />
      <Trash />
    </SettingsPage>
  );
}

function ServerAddress({ serverUrl }: { serverUrl: string }) {
  const t = useTranslations("mcp.settings");
  const [copied, setCopied] = useState(false);
  return (
    <SettingsSection
      id="settings-mcp-address"
      title={t("addressTitle")}
      description={t("addressHint", { appName: APP_NAME })}
    >
      <div className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row">
        <Input
          readOnly
          data-tutorial="apps-server-address"
          value={serverUrl}
          aria-label={t("addressTitle")}
          className="font-mono text-sm"
          onFocus={(event) => event.target.select()}
        />
        <Button
          variant="secondary"
          data-tutorial="apps-copy-address"
          onClick={() => {
            void navigator.clipboard?.writeText(serverUrl).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? (
            <CheckIcon aria-hidden data-icon="inline-start" />
          ) : (
            <CopyIcon aria-hidden data-icon="inline-start" />
          )}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </SettingsSection>
  );
}

function Apps() {
  const t = useTranslations("mcp.settings");
  const apps = useConnectedApps();
  const list = apps.data ?? [];
  const counts = useConnectedAppCounts(list.map((app) => app.id));
  const spaces = useMySpaceNames();
  const workspace = useWorkspace();
  const nameOf = (spaceId: string) => {
    if (spaceId === workspace.userId) return t("ownCompany");
    const space = spaces.data?.find((item) => item.spaceId === spaceId);
    return space?.companyName ?? space?.ownerName ?? t("company");
  };
  return (
    <SettingsSection
      id="settings-connected-apps"
      title={t("appsTitle")}
      description={t("appsHint")}
    >
      <div data-tutorial="apps-list" className="flex flex-col gap-3 py-4 first:pt-0">
        {apps.isPending ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : apps.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : list.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <PlugIcon aria-hidden className="size-4" />
            {t("none")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
            {list.map((app) => (
              <AppRow
                key={app.id}
                app={app}
                actions={counts.data?.get(app.id) ?? null}
                companies={app.spaceIds.map(nameOf)}
                activeCompany={nameOf(app.spaceId)}
              />
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

function AppRow({
  app,
  actions,
  companies,
  activeCompany,
}: {
  app: ConnectedApp;
  actions: number | null;
  companies: string[];
  activeCompany: string;
}) {
  const t = useTranslations("mcp.settings");
  const tLevels = useTranslations("mcp.consent.levels");
  const settings = useFormatSettings();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const setLevel = useSetAppLevel();
  const disconnect = useDisconnectApp();
  const error = setLevel.error ?? disconnect.error;
  return (
    <li className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-tutorial="apps-app-row"
        className="flex min-h-11 w-full cursor-pointer items-start justify-between gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold text-ink">{app.clientName}</span>
          <span className="text-xs text-ink-muted">
            {t("summary", {
              level: tLevels(`${app.level}.title`),
              company:
                companies.length > 1
                  ? t("companies", { active: activeCompany, count: companies.length })
                  : activeCompany,
            })}
          </span>
          <span className="text-xs text-ink-muted">
            {t("dates", {
              connected: formatDateTime(new Date(app.createdAt), settings),
              used: app.lastUsedAt
                ? formatRelativeTime(new Date(app.lastUsedAt), new Date(), locale)
                : t("never"),
            })}
            {actions !== null &&
              ` · ${t("actions", { count: actions })}`}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "mt-1 size-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label={t("levelLabel")} data-tutorial="apps-level" className="grid gap-2 sm:grid-cols-3">
            {MCP_LEVELS.map((level) => {
              const Icon = LEVEL_ICONS[level];
              return (
                <ChoiceTile
                  key={level}
                  checked={app.level === level}
                  disabled={setLevel.isPending}
                  onSelect={() => setLevel.mutate({ id: app.id, level: level as McpLevel })}
                  icon={<Icon className="size-4 shrink-0" aria-hidden />}
                  title={tLevels(`${level}.title`)}
                />
              );
            })}
          </div>
          <History grantId={app.id} />
          {error && (
            <FormAlert>
              {t(`errors.${error instanceof McpActionError ? error.code : "failed"}`)}
            </FormAlert>
          )}
          <div>
            <Button variant="destructive" data-tutorial="apps-disconnect" onClick={() => setConfirming(true)}>
              {t("disconnect")}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("disconnectTitle", { name: app.clientName })}
        description={t("disconnectHint")}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        closeLabel={t("cancel")}
        pending={disconnect.isPending}
        onConfirm={() => disconnect.mutate(app.id, { onSuccess: () => setConfirming(false) })}
      />
    </li>
  );
}

function History({ grantId }: { grantId: string }) {
  const t = useTranslations("mcp.settings");
  const settings = useFormatSettings();
  const calls = useConnectedAppCalls(grantId);
  return (
    <div data-tutorial="apps-history" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
        {t("historyTitle")}
      </h3>
      {calls.isPending ? (
        <Skeleton className="h-12 rounded-xl" />
      ) : !calls.data?.length ? (
        <p className="text-xs text-ink-muted">{t("historyNone")}</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
          {calls.data.map((call) => (
            <li key={call.id} className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0 truncate", call.ok ? "text-ink" : "text-pink")}>
                {call.summary ?? <code className="font-mono">{call.tool}</code>}
                {!call.ok && ` · ${t("callFailed")}`}
              </span>
              <span className="shrink-0 text-ink-muted">
                {formatDateTime(new Date(call.createdAt), settings)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Trash() {
  const t = useTranslations("mcp.trash");
  const settings = useFormatSettings();
  const trash = useTrash();
  const days = useTrashRetention();
  const restore = useRestoreFromTrash();
  const [restoring, setRestoring] = useState<string | null>(null);
  return (
    <SettingsSection
      id="settings-trash"
      title={t("title")}
      description={t("hint", { days: days.data ?? 7 })}
    >
      <div data-tutorial="apps-trash" className="flex flex-col gap-3 py-4 first:pt-0">
        {trash.isPending ? (
          <Skeleton className="h-12 rounded-2xl" />
        ) : !trash.data?.length ? (
          <p className="text-sm text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
            {trash.data.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink">
                    {item.title ?? t(`kinds.${item.kind}`)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t("line", {
                      kind: t(`kinds.${item.kind}`),
                      via: t(`via.${item.via}`),
                      when: formatDateTime(new Date(item.deletedAt), settings),
                    })}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => {
                    setRestoring(item.id);
                    restore.mutate(item.id, { onSettled: () => setRestoring(null) });
                  }}
                >
                  <RotateCcwIcon aria-hidden data-icon="inline-start" />
                  {restoring === item.id ? t("restoring") : t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {restore.error && (
          <FormAlert>
            {t(`errors.${restore.error instanceof McpActionError ? restore.error.code : "failed"}`)}
          </FormAlert>
        )}
      </div>
    </SettingsSection>
  );
}
