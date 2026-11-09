"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toneFill, type Tone } from "@/components/ui/tone";
import { TonePicker } from "@/components/ui/tone-picker";
import { SettingsPage, SettingsSection } from "@/features/settings/ui";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import type { SchedulerError } from "../actions";
import {
  SchedulerActionError,
  useAddSubscription,
  useCalendarSubscriptions,
  useCreateFeed,
  useDeleteSubscription,
  useFeedState,
  useRefreshSubscription,
  useRevokeFeed,
  useUpdateSubscription,
} from "../queries";
import {
  MAX_SUBSCRIPTIONS,
  SUBSCRIPTION_NAME_MAX,
  TYPE_TONES,
  type CalendarSubscription,
} from "../types";

const HELP = ["google", "apple", "outlook"] as const;

/** Every code a subscription can fail with, each with its sentence in `settings.calendar.errors`. */
const ERROR_CODES = new Set([
  "invalid",
  "notHttps",
  "blocked",
  "timeout",
  "tooLarge",
  "http",
  "notCalendar",
  "network",
  "key",
  "store",
  "notConfigured",
  "tooMany",
  "tooSoon",
  "notFound",
  "unauthenticated",
  "forbidden",
  "readOnly",
  "unknown",
]);

function known(code: string | null | undefined): string {
  return code && ERROR_CODES.has(code) ? code : "network";
}

function errorCode(error: unknown): SchedulerError | "unknown" {
  return error instanceof SchedulerActionError ? error.code : "unknown";
}

/**
 * Settings → Calendar: other calendars whose busy times the scheduler keeps
 * free (their secret ICS links), and the Gradus calendar as a link to
 * subscribe to in Google, Apple or Outlook.
 */
export function CalendarSettingsView() {
  const t = useTranslations("settings");
  return (
    <SettingsPage title={t("groups.calendar.title")} description={t("groups.calendar.description")}>
      <Subscriptions />
      <Feed />
    </SettingsPage>
  );
}

function Subscriptions() {
  const t = useTranslations("settings.calendar");
  const subscriptions = useCalendarSubscriptions();
  const list = subscriptions.data ?? [];
  return (
    <SettingsSection
      id="settings-calendar-subscriptions"
      title={t("subscriptionsTitle")}
      description={t("subscriptionsHint")}
    >
      <div className="flex flex-col gap-4 py-4 first:pt-0">
        {subscriptions.isPending ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : subscriptions.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : list.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
            {list.map((subscription) => (
              <SubscriptionRow key={subscription.id} subscription={subscription} />
            ))}
          </ul>
        )}
        {list.length < MAX_SUBSCRIPTIONS ? (
          <AddSubscription />
        ) : (
          <p className="text-xs text-ink-muted">{t("max", { count: MAX_SUBSCRIPTIONS })}</p>
        )}
        <Help />
      </div>
    </SettingsSection>
  );
}

function SubscriptionRow({ subscription }: { subscription: CalendarSubscription }) {
  const t = useTranslations("settings.calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const update = useUpdateSubscription();
  const remove = useDeleteSubscription();
  const refresh = useRefreshSubscription();
  const [confirm, setConfirm] = useState(false);
  const fetched = subscription.last_fetched_at ? new Date(subscription.last_fetched_at) : null;
  const refreshCode = refresh.data && !refresh.data.ok ? refresh.data.code : null;
  const failed = subscription.last_status === "error";

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-3 shrink-0 rounded-full",
            toneFill[(subscription.color as Tone) ?? "neutral"],
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink">{subscription.name}</span>
          <span className="truncate text-xs text-ink-muted">{subscription.url_hint}</span>
          <span className={cn("text-xs", failed ? "text-pink" : "text-ink-muted")}>
            {failed
              ? t(`errors.${known(subscription.last_error)}`)
              : fetched
                ? t("fetched", {
                    when: formatRelativeTime(fetched, new Date(), locale),
                    at: formatDateTime(fetched, settings),
                  })
                : t("pending")}
          </span>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          <Switch
            checked={subscription.show_in_calendar}
            aria-label={t("showInCalendar", { name: subscription.name })}
            onCheckedChange={(checked) =>
              update.mutate({ id: subscription.id, patch: { show_in_calendar: checked } })
            }
          />
          <span className="hidden sm:inline">{t("show")}</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate(subscription.id)}
        >
          <RefreshCwIcon
            aria-hidden
            className={cn(refresh.isPending && "animate-spin motion-reduce:animate-none")}
          />
          {t("refresh")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(true)}>
          <Trash2Icon aria-hidden className="text-destructive" />
          {t("remove")}
        </Button>
      </div>
      {refresh.isError && <FormAlert>{t(`errors.${known(errorCode(refresh.error))}`)}</FormAlert>}
      {refreshCode && <FormAlert>{t(`errors.${known(refreshCode)}`)}</FormAlert>}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("removeTitle", { name: subscription.name })}
        description={t("removeText")}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("errors.unknown") : null}
        onConfirm={() => remove.mutate(subscription.id, { onSuccess: () => setConfirm(false) })}
      />
    </li>
  );
}

function AddSubscription() {
  const t = useTranslations("settings.calendar");
  const tColors = useTranslations("scheduler.colors");
  const add = useAddSubscription();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<Tone>("teal");
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? t("nameRequired") : undefined;
  const urlError = touched && !url.trim() ? t("urlRequired") : undefined;

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!name.trim() || !url.trim()) return;
        add.mutate(
          { name: name.trim(), url: url.trim(), color },
          {
            onSuccess: () => {
              setName("");
              setUrl("");
              setTouched(false);
            },
          },
        );
      }}
    >
      <h3 className="text-sm font-semibold text-ink">{t("addTitle")}</h3>
      <FormField id="subscription-name" label={t("name")} error={nameError}>
        <Input
          {...fieldA11y("subscription-name", nameError)}
          value={name}
          maxLength={SUBSCRIPTION_NAME_MAX}
          placeholder={t("namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField id="subscription-url" label={t("url")} error={urlError} hint={t("urlHint")}>
        <Input
          {...fieldA11y("subscription-url", urlError, true)}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          onChange={(event) => setUrl(event.target.value)}
        />
      </FormField>
      <TonePicker
        tones={TYPE_TONES}
        value={color}
        onChange={setColor}
        label={t("color")}
        labelOf={(tone) => tColors(tone)}
      />
      {add.isError && <FormAlert>{t(`errors.${known(errorCode(add.error))}`)}</FormAlert>}
      {add.isSuccess && (
        <FormAlert tone="success">{t("added", { count: add.data.intervals })}</FormAlert>
      )}
      <Button type="submit" className="self-start" disabled={add.isPending}>
        {add.isPending ? t("adding") : t("add")}
      </Button>
    </form>
  );
}

function Help() {
  const t = useTranslations("settings.calendar.help");
  return (
    <details className="group rounded-2xl border border-line px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {t("title")}
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {HELP.map((provider) => (
          <div key={provider} className="flex flex-col gap-1.5">
            <h4 className="text-sm font-semibold text-ink">{t(`${provider}.name`)}</h4>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
              {[1, 2, 3, 4].map((step) => (
                <li key={step}>{t(`${provider}.step${step}`)}</li>
              ))}
            </ol>
          </div>
        ))}
        <p className="text-xs text-ink-muted">{t("privacy")}</p>
      </div>
    </details>
  );
}

function Feed() {
  const t = useTranslations("settings.calendar.feed");
  const settings = useFormatSettings();
  const state = useFeedState();
  const create = useCreateFeed();
  const revoke = useRevokeFeed();
  const [copied, setCopied] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const url = create.data?.url ?? null;
  const active = state.data?.active ?? false;

  return (
    <SettingsSection id="settings-calendar-feed" title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4 py-4 first:pt-0">
        {state.isPending ? (
          <Skeleton className="h-12 rounded-xl" />
        ) : state.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : url ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{t("created")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={url}
                aria-label={t("link")}
                className="font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => setCopied(true))
                    .catch(() => undefined)
                }
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? t("copied") : t("copy")}
              </Button>
            </div>
            <p className="text-xs text-ink-muted">{t("onceHint")}</p>
          </div>
        ) : active ? (
          <p className="text-sm text-ink">
            {t("active", { date: formatDateTime(new Date(state.data!.createdAt!), settings) })}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">{t("inactive")}</p>
        )}
        {(create.isError || revoke.isError) && <FormAlert>{t("failed")}</FormAlert>}
        <div className="flex flex-wrap gap-2">
          {!active && !url ? (
            <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
              {t("create")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setConfirmRenew(true)}
              >
                {t("renew")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(undefined, { onSuccess: () => create.reset() })}
              >
                {t("revoke")}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-ink-muted">{t("howTo")}</p>
      </div>
      <ConfirmDialog
        open={confirmRenew}
        onOpenChange={setConfirmRenew}
        title={t("renewTitle")}
        description={t("renewText")}
        confirmLabel={t("renew")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={create.isPending}
        onConfirm={() =>
          create.mutate(undefined, {
            onSuccess: () => {
              setConfirmRenew(false);
              setCopied(false);
            },
          })
        }
      />
    </SettingsSection>
  );
}
