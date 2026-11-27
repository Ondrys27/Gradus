"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLinkIcon, RefreshCwIcon, UnplugIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/features/settings/ui";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  normalizeSelection,
  providerCardState,
  type CalendarSyncOverview,
  type SyncConnection,
} from "../overview";
import { GOOGLE_START_PATH } from "../paths";
import {
  SyncActionFailure,
  useCalendarSyncOverview,
  useConnectApple,
  useDisconnect,
  useSaveSelection,
  useSyncNow,
} from "../queries";
import type { ProviderKey } from "../types";
import type { SyncCalendarView } from "../overview";
import { useMySources, useSetPrivateDefault } from "../../sharing/queries";

/** Apple's page where an app-specific password is made. */
const APPLE_ID_URL = "https://appleid.apple.com/account/manage";

/** What Google's callback says in the address, each with its sentence. */
const GOOGLE_RESULTS = new Set([
  "connected",
  "cancelled",
  "expired",
  "failed",
  "scopes",
  "notAllowed",
  "unavailable",
]);

function failureCode(error: unknown): string {
  return error instanceof SyncActionFailure ? error.code : "unknown";
}

/**
 * Settings → Calendar, two-way sync (28.10): a card for Google and one for
 * Apple, each with its state, the last sync, "Sync now", the calendars to
 * read and the one to write to, and Disconnect. Accounts the switch does not
 * let in yet see that it is being prepared.
 */
export function CalendarConnections() {
  const t = useTranslations("settings.calendar.sync");
  const overview = useCalendarSyncOverview();
  const params = useSearchParams();
  const googleResult = params.get("google");

  if (overview.isPending) {
    return (
      <SettingsSection id="settings-calendar-google" title={t("google.title")}>
        <Skeleton className="h-24 rounded-2xl" />
      </SettingsSection>
    );
  }
  if (overview.isError) {
    return (
      <SettingsSection id="settings-calendar-google" title={t("google.title")}>
        <FormAlert>{t("loadFailed")}</FormAlert>
      </SettingsSection>
    );
  }
  const data = overview.data;
  const notAllowed = !data.allowed && data.connections.length === 0;
  if (notAllowed) {
    return (
      <SettingsSection id="settings-calendar-google" title={t("google.title")}>
        <p className="text-sm text-ink-soft" data-testid="calendar-sync-preparing">
          {t("preparing")}
        </p>
      </SettingsSection>
    );
  }
  return (
    <>
      <ProviderCard provider="google" overview={data} result={googleResult} />
      <ProviderCard provider="apple" overview={data} result={null} />
    </>
  );
}

function ProviderCard({
  provider,
  overview,
  result,
}: {
  provider: ProviderKey;
  overview: CalendarSyncOverview;
  result: string | null;
}) {
  const t = useTranslations("settings.calendar.sync");
  const state = providerCardState(overview, provider);
  const connection = overview.connections.find((item) => item.provider === provider) ?? null;
  return (
    <SettingsSection
      id={`settings-calendar-${provider}`}
      title={t(`${provider}.title`)}
      description={t(`${provider}.description`)}
    >
      <div
        className="flex flex-col gap-4 py-4 first:pt-0"
        data-testid={`calendar-sync-${provider}`}
      >
        {result && GOOGLE_RESULTS.has(result) && (
          <FormAlert tone={result === "connected" ? "success" : "error"}>
            {t(`results.${result}`)}
          </FormAlert>
        )}
        {state === "unavailable" && <FormAlert>{t("unavailable")}</FormAlert>}
        {state === "notAllowed" && <p className="text-sm text-ink-soft">{t("preparing")}</p>}
        {state === "connect" &&
          (provider === "google" ? (
            <a
              href={GOOGLE_START_PATH}
              className={buttonVariants({ className: "self-start" })}
              data-testid="calendar-sync-google-connect"
            >
              {t("google.connect")}
            </a>
          ) : (
            <AppleForm />
          ))}
        {connection && <ConnectionBody connection={connection} broken={state === "broken"} />}
        {state === "broken" && provider === "apple" && <AppleForm reconnect />}
        {state === "broken" && provider === "google" && overview.google && (
          <a
            href={GOOGLE_START_PATH}
            className={buttonVariants({ variant: "outline", className: "self-start" })}
          >
            {t("google.reconnect")}
          </a>
        )}
      </div>
    </SettingsSection>
  );
}

function ConnectionBody({ connection, broken }: { connection: SyncConnection; broken: boolean }) {
  const t = useTranslations("settings.calendar.sync");
  const locale = useLocale();
  const settings = useFormatSettings();
  const syncNow = useSyncNow();
  const disconnect = useDisconnect();
  const [confirm, setConfirm] = useState(false);
  const synced = connection.lastSyncedAt ? new Date(connection.lastSyncedAt) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={broken ? "pink" : "green"} dot>
          {broken ? t("state.broken") : t("state.connected")}
        </StatusPill>
        {connection.accountLabel && (
          <span className="truncate text-sm text-ink-soft">{connection.accountLabel}</span>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        {synced
          ? t("lastSync", {
              when: formatRelativeTime(synced, new Date(), locale),
              at: formatDateTime(synced, settings),
            })
          : t("neverSynced")}
      </p>
      {broken && (
        <FormAlert>
          {t(`connectionErrors.${connection.lastError === "auth" ? "auth" : "other"}`)}
        </FormAlert>
      )}
      <CalendarChoice key={selectionKey(connection)} connection={connection} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncNow.isPending || broken}
          onClick={() => syncNow.mutate(connection.id)}
        >
          <RefreshCwIcon
            aria-hidden
            className={cn(syncNow.isPending && "animate-spin motion-reduce:animate-none")}
          />
          {t("syncNow")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          <UnplugIcon aria-hidden className="text-destructive" />
          {t("disconnect")}
        </Button>
      </div>
      {syncNow.isError && (
        <FormAlert>{t(`errors.${actionError(failureCode(syncNow.error))}`)}</FormAlert>
      )}
      {syncNow.isSuccess && (syncNow.data.failed ?? 0) > 0 && (
        <FormAlert>{t("errors.partial")}</FormAlert>
      )}
      {syncNow.isSuccess && !(syncNow.data.failed ?? 0) && (
        <FormAlert tone="success">{t("synced")}</FormAlert>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("disconnectTitle", { provider: t(`${connection.provider}.name`) })}
        description={t("disconnectText")}
        confirmLabel={t("disconnect")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={disconnect.isPending}
        error={disconnect.isError ? t("errors.unknown") : null}
        onConfirm={() => disconnect.mutate(connection.id, { onSuccess: () => setConfirm(false) })}
      />
    </div>
  );
}

const ACTION_ERRORS = new Set([
  "unauthenticated",
  "notAllowed",
  "unavailable",
  "invalid",
  "auth",
  "network",
  "notFound",
  "tooSoon",
  "unknown",
]);

function actionError(code: string): string {
  return ACTION_ERRORS.has(code) ? code : "unknown";
}

function selectionKey(connection: SyncConnection): string {
  return connection.calendars
    .map((calendar) => `${calendar.id}:${calendar.read ? 1 : 0}${calendar.write ? 1 : 0}`)
    .join(",");
}

/** Which calendars are read (busy times + shown) and the one Gradus writes to. */
function CalendarChoice({ connection }: { connection: SyncConnection }) {
  const t = useTranslations("settings.calendar.sync");
  const save = useSaveSelection();
  const initialRead = connection.calendars
    .filter((calendar) => calendar.read)
    .map((calendar) => calendar.id);
  const initialWrite = connection.calendars.find((calendar) => calendar.write)?.id ?? null;
  // Starts from what is stored; a saved change remounts it (`selectionKey`).
  const [read, setRead] = useState<string[]>(initialRead);
  const [write, setWrite] = useState<string | null>(initialWrite);

  if (!connection.calendars.length)
    return <p className="text-sm text-ink-muted">{t("noCalendars")}</p>;
  const next = normalizeSelection(connection.calendars, read, write);
  const dirty =
    next.write !== initialWrite ||
    next.read.length !== initialRead.length ||
    next.read.some((id) => !initialRead.includes(id));
  const groupName = `write-${connection.id}`;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">{t("calendarsTitle")}</legend>
      <p className="text-xs text-ink-muted">{t("calendarsHint")}</p>
      <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
        {connection.calendars.map((calendar) => {
          const reading = next.read.includes(calendar.id);
          return (
            <li key={calendar.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {calendar.name}
                {calendar.isPrimary && (
                  <span className="ml-2 text-xs text-ink-muted">{t("primary")}</span>
                )}
              </span>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-8">
                <Checkbox
                  checked={reading}
                  disabled={next.write === calendar.id}
                  onCheckedChange={(checked) =>
                    setRead((current) =>
                      checked
                        ? [...current, calendar.id]
                        : current.filter((id) => id !== calendar.id),
                    )
                  }
                />
                {t("read")}
              </label>
              <label
                className={cn(
                  "flex min-h-11 items-center gap-2 text-sm mouse:min-h-8",
                  calendar.canWrite ? "text-ink-soft" : "text-ink-muted",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  className="size-4 accent-teal"
                  checked={next.write === calendar.id}
                  disabled={!calendar.canWrite}
                  onChange={() => setWrite(calendar.id)}
                />
                {calendar.canWrite ? t("write") : t("readOnly")}
              </label>
            </li>
          );
        })}
      </ul>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-8">
        <input
          type="radio"
          name={groupName}
          className="size-4 accent-teal"
          checked={next.write === null}
          onChange={() => setWrite(null)}
        />
        {t("writeNone")}
      </label>
      <PrivateDefaults calendars={connection.calendars.filter((calendar) => calendar.read)} />
      {save.isError && <FormAlert>{t(`errors.${actionError(failureCode(save.error))}`)}</FormAlert>}
      {dirty && (
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ connectionId: connection.id, read: next.read, write: next.write })
          }
        >
          {t("save")}
        </Button>
      )}
    </fieldset>
  );
}

/**
 * "Everything from this calendar is private" (30.3): the others in the
 * company see its events only as busy time, whatever they were shared.
 */
function PrivateDefaults({ calendars }: { calendars: SyncCalendarView[] }) {
  const t = useTranslations("settings.calendar.sync");
  const sources = useMySources(calendars.length > 0);
  const setPrivate = useSetPrivateDefault();
  if (!calendars.length) return null;
  const privateOf = new Map(
    (sources.data ?? []).map((source) => [source.key, source.privateDefault]),
  );
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-sm font-medium text-ink">{t("privateTitle")}</p>
      <p className="text-xs text-ink-muted">{t("privateHint")}</p>
      {calendars.map((calendar) => (
        <label
          key={calendar.id}
          className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-soft mouse:min-h-9"
        >
          <span className="truncate">{t("privateOf", { name: calendar.name })}</span>
          <Switch
            checked={privateOf.get(calendar.id) ?? false}
            disabled={sources.isPending || setPrivate.isPending}
            onCheckedChange={(checked) =>
              setPrivate.mutate({ calendarId: calendar.id, private: checked })
            }
            data-testid={`calendar-private-default-${calendar.id}`}
          />
        </label>
      ))}
    </div>
  );
}

/** Apple: the Apple ID and an app-specific password, with the steps to make one. */
export function AppleForm({
  reconnect = false,
  from = "settings",
}: {
  reconnect?: boolean;
  /** Where it is shown: Settings → Calendar, or the scheduler's Availability (30.4). */
  from?: "settings" | "scheduler";
}) {
  const t = useTranslations("settings.calendar.sync.apple");
  const tSync = useTranslations("settings.calendar.sync");
  const connect = useConnectApple();
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const idError = touched && !appleId.trim() ? t("idRequired") : undefined;
  const passwordError = touched && !password.trim() ? t("passwordRequired") : undefined;

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!appleId.trim() || !password.trim()) return;
        connect.mutate(
          { appleId: appleId.trim(), password, from },
          {
            onSuccess: () => {
              setPassword("");
              setTouched(false);
            },
          },
        );
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
        <li>
          {t("step1")}{" "}
          <a
            href={APPLE_ID_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-violet underline-offset-4 hover:underline"
          >
            appleid.apple.com
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        </li>
        <li>{t("step2")}</li>
        <li>{t("step3")}</li>
      </ol>
      <FormField id="apple-id" label={t("id")} error={idError}>
        <Input
          {...fieldA11y("apple-id", idError)}
          type="email"
          autoComplete="username"
          value={appleId}
          onChange={(event) => setAppleId(event.target.value)}
        />
      </FormField>
      <FormField
        id="apple-password"
        label={t("password")}
        error={passwordError}
        hint={t("passwordHint")}
      >
        <PasswordInput
          {...fieldA11y("apple-password", passwordError, true)}
          showLabel={t("showPassword")}
          hideLabel={t("hidePassword")}
          autoComplete="off"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      {connect.isError && (
        <FormAlert>{tSync(`errors.${actionError(failureCode(connect.error))}`)}</FormAlert>
      )}
      {connect.isSuccess && <FormAlert tone="success">{t("connected")}</FormAlert>}
      <Button type="submit" className="self-start" disabled={connect.isPending}>
        {connect.isPending ? t("connecting") : reconnect ? t("reconnect") : t("connect")}
      </Button>
    </form>
  );
}
