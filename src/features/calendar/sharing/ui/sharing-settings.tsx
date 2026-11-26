"use client";

import { useState, type FormEvent } from "react";
import { BuildingIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useActiveMembers } from "@/features/account/active-members";
import { useSession, useUserSettings } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useShareGroups } from "@/features/notes/sharing/queries";
import { SettingRow, SettingsSection } from "@/features/settings/ui";
import { useSettingsSave } from "@/features/settings/save-state";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { GRADUS_SOURCE, SHARE_LEVELS, type ShareLevel, type ShareTarget } from "../levels";
import {
  useCalendarPeople,
  useMyShares,
  useMySources,
  useRemoveShare,
  useSaveShare,
  useShareRequests,
  type MyShare,
  type MySource,
} from "../queries";
import { AnswerForm } from "./answer-request-dialog";
import { LevelChoice } from "./level-choice";
import { RequestShareButton } from "./request-share-dialog";

/**
 * Settings → Calendar → Sharing (30.3): requests waiting for the account,
 * who sees its calendar (people, groups, the whole company; the level and
 * which calendars), adding and changing a share, and whose calendars it
 * sees. The owner switches off seeing their people's busy times here.
 */
export function CalendarSharingSettings() {
  const t = useTranslations("calendar.sharing.settings");
  const workspace = useWorkspace();
  const ownSpace = workspace.role === "owner";
  return (
    <SettingsSection
      id="settings-calendar-sharing"
      title={t("title")}
      description={t("description")}
    >
      <div className="flex flex-col gap-6 py-4 first:pt-0" data-testid="calendar-sharing-settings">
        <IncomingRequests />
        <WhoSeesMine />
        {ownSpace && <OwnerDefault />}
        <WhoseISee />
        <MyRequests />
      </div>
    </SettingsSection>
  );
}

function IncomingRequests() {
  const t = useTranslations("calendar.sharing.settings");
  const requests = useShareRequests();
  const waiting = (requests.data ?? []).filter(
    (request) => request.incoming && request.status === "pending",
  );
  if (!waiting.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t("waiting")}</h3>
      <ul className="flex flex-col gap-3">
        {waiting.map((request) => (
          <li key={request.id} className="rounded-2xl border border-teal/40 bg-teal/5 p-4">
            <AnswerForm request={request} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function sourceName(source: MySource, t: (key: string) => string) {
  return source.key === GRADUS_SOURCE ? t("gradus") : (source.name ?? t("external"));
}

function WhoSeesMine() {
  const t = useTranslations("calendar.sharing.settings");
  const shares = useMyShares();
  const sources = useMySources();
  const [adding, setAdding] = useState(false);
  const list = shares.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t("whoSeesMine")}</h3>
      {shares.isPending ? (
        <Skeleton className="h-16 rounded-2xl" />
      ) : shares.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("nobody")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
          {list.map((share) => (
            <ShareRow key={share.shareId ?? "auto"} share={share} sources={sources.data ?? []} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddShare sources={sources.data ?? []} existing={list} onDone={() => setAdding(false)} />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setAdding(true)}
          data-testid="calendar-share-add"
        >
          {t("add")}
        </Button>
      )}
    </section>
  );
}

function TargetIcon({ share }: { share: MyShare }) {
  if (share.targetKind === "member")
    return <Avatar src={share.avatarUrl} name={share.name} className="size-9" />;
  const Icon = share.targetKind === "group" ? UsersIcon : BuildingIcon;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-hover text-ink-soft">
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

function ShareRow({ share, sources }: { share: MyShare; sources: MySource[] }) {
  const t = useTranslations("calendar.sharing");
  const settings = useFormatSettings();
  const save = useSaveShare();
  const remove = useRemoveShare();
  const [confirm, setConfirm] = useState(false);
  const label =
    share.targetKind === "space"
      ? t("settings.wholeCompany")
      : share.targetKind === "group"
        ? t("settings.group", {
            name: share.name ?? "",
            count: share.memberCount ?? 0,
            formatted: formatNumber(share.memberCount ?? 0, {}, settings),
          })
        : (share.name ?? t("settings.someone"));
  const target = share.targetKind === "member" ? share.targetUserId : share.groupId;

  function change(patch: { level?: ShareLevel; calendars?: string[] }) {
    if (share.entry !== "share") return;
    save.mutate({
      targetKind: share.targetKind,
      target,
      level: patch.level ?? share.level,
      calendars: patch.calendars ?? share.calendars,
      created: false,
    });
  }

  return (
    <li className="flex flex-col gap-3 p-4" data-testid="calendar-share-row">
      <div className="flex items-center gap-3">
        <TargetIcon share={share} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{label}</span>
          {share.entry === "auto" && (
            <span className="text-xs text-ink-muted">{t("settings.autoHint")}</span>
          )}
        </div>
        {share.entry === "share" ? (
          <Select
            value={share.level}
            items={SHARE_LEVELS.map((level) => ({ value: level, label: t(`levels.${level}`) }))}
            onValueChange={(level) => level && change({ level: level as ShareLevel })}
          >
            <SelectTrigger
              className="w-36"
              aria-label={t("levels.label")}
              data-testid="calendar-share-level"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHARE_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {t(`levels.${level}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-ink-soft">{t("levels.busy")}</span>
        )}
      </div>
      {share.entry === "share" && sources.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {sources.map((source) => {
            const on = share.calendars.includes(source.key);
            return (
              <label
                key={source.key}
                className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-8"
              >
                <Checkbox
                  checked={on}
                  // At least one calendar stays shared; removing the share is the way to stop.
                  disabled={on && share.calendars.length === 1}
                  onCheckedChange={(checked) =>
                    change({
                      calendars: checked
                        ? [...share.calendars, source.key]
                        : share.calendars.filter((key) => key !== source.key),
                    })
                  }
                />
                {sourceName(source, (key) => t(`settings.${key}`))}
              </label>
            );
          })}
        </div>
      )}
      {share.entry === "share" && share.shareId && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setConfirm(true)}
          data-testid="calendar-share-remove"
        >
          <Trash2Icon aria-hidden className="text-destructive" />
          {t("settings.remove")}
        </Button>
      )}
      {(save.isError || remove.isError) && <FormAlert>{t("errors.unknown")}</FormAlert>}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings.removeTitle", { name: label })}
        description={t("settings.removeText")}
        confirmLabel={t("settings.remove")}
        cancelLabel={t("settings.cancel")}
        closeLabel={t("settings.close")}
        pending={remove.isPending}
        onConfirm={() =>
          share.shareId && remove.mutate(share.shareId, { onSuccess: () => setConfirm(false) })
        }
      />
    </li>
  );
}

function AddShare({
  sources,
  existing,
  onDone,
}: {
  sources: MySource[];
  existing: MyShare[];
  onDone: () => void;
}) {
  const t = useTranslations("calendar.sharing");
  const { user } = useSession();
  const members = useActiveMembers();
  const groups = useShareGroups();
  const save = useSaveShare();
  const [kind, setKind] = useState<ShareTarget>("member");
  const [target, setTarget] = useState<string | null>(null);
  const [level, setLevel] = useState<ShareLevel>("busy");
  const [calendars, setCalendars] = useState<string[]>(() => sources.map((source) => source.key));
  const chosen = calendars.length ? calendars : [GRADUS_SOURCE];

  const people = (members.data ?? []).filter((member) => member.userId !== user.id);
  const options =
    kind === "member"
      ? people.map((member) => ({ value: member.userId, label: member.name }))
      : kind === "group"
        ? (groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))
        : [];
  const already = existing.some(
    (share) =>
      share.entry === "share" &&
      share.targetKind === kind &&
      (kind === "space" || share.targetUserId === target || share.groupId === target),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (kind !== "space" && !target) return;
    save.mutate(
      {
        targetKind: kind,
        target: kind === "space" ? null : target,
        level,
        calendars: chosen,
        created: !already,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
      data-testid="calendar-share-form"
    >
      <h4 className="text-sm font-semibold text-ink">{t("settings.addTitle")}</h4>
      <div role="radiogroup" aria-label={t("settings.with")} className="grid grid-cols-3 gap-2">
        {(["member", "group", "space"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => {
              setKind(option);
              setTarget(null);
            }}
            className={
              kind === option
                ? "min-h-11 cursor-pointer rounded-xl border border-teal/60 bg-teal/10 px-2 text-sm font-medium text-teal mouse:min-h-9"
                : "min-h-11 cursor-pointer rounded-xl border border-line px-2 text-sm text-ink-soft hover:text-ink mouse:min-h-9"
            }
          >
            {t(`settings.targets.${option}`)}
          </button>
        ))}
      </div>
      {kind !== "space" && (
        <FormField id="calendar-share-target" label={t(`settings.targets.${kind}`)}>
          <Select
            value={target ?? ""}
            items={options}
            onValueChange={(next) => setTarget(next || null)}
          >
            <SelectTrigger id="calendar-share-target" data-testid="calendar-share-target">
              <SelectValue placeholder={t("settings.pick")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <LevelChoice name="calendar-share-level" value={level} onChange={setLevel} />
      {sources.length > 1 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium text-ink-soft">
            {t("settings.calendars")}
          </legend>
          {sources.map((source) => (
            <label
              key={source.key}
              className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-8"
            >
              <Checkbox
                checked={chosen.includes(source.key)}
                onCheckedChange={(checked) =>
                  setCalendars((current) =>
                    checked
                      ? [...current, source.key]
                      : current.filter((key) => key !== source.key),
                  )
                }
              />
              {sourceName(source, (key) => t(`settings.${key}`))}
            </label>
          ))}
        </fieldset>
      )}
      {already && <p className="text-xs text-ink-muted">{t("settings.replaces")}</p>}
      {save.isError && <FormAlert>{t("errors.unknown")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("settings.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || (kind !== "space" && !target)}
          data-testid="calendar-share-save"
        >
          {t("settings.save")}
        </Button>
      </div>
    </form>
  );
}

function OwnerDefault() {
  const t = useTranslations("calendar.sharing.settings");
  const settings = useUserSettings();
  const { save } = useSettingsSave();
  return (
    <SettingRow
      id="settings-calendar-owner-busy"
      label={t("ownerBusy")}
      hint={t("ownerBusyHint")}
      fields={["calendar_owner_sees_busy"]}
    >
      <div className="flex md:justify-end">
        <Switch
          id="settings-calendar-owner-busy"
          checked={settings.calendar_owner_sees_busy}
          onCheckedChange={(checked) => save({ calendar_owner_sees_busy: checked })}
        />
      </div>
    </SettingRow>
  );
}

function WhoseISee() {
  const t = useTranslations("calendar.sharing");
  const people = useCalendarPeople();
  const list = people.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t("settings.whoseISee")}</h3>
      {people.isPending ? (
        <Skeleton className="h-16 rounded-2xl" />
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("settings.noneShared")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
          {list.map((person) => (
            <li
              key={person.userId}
              className="flex flex-wrap items-center gap-3 p-4"
              data-testid="calendar-visible-person"
            >
              <Avatar src={person.avatarUrl} name={person.name} className="size-9" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-ink">{person.name}</span>
                <span className="text-xs text-ink-muted">
                  {person.sources
                    .map((source) =>
                      source.key === GRADUS_SOURCE
                        ? `${t("settings.gradus")}: ${t(`levels.${source.level}`)}`
                        : `${source.name ?? t("settings.external")}: ${t(`levels.${source.level}`)}`,
                    )
                    .join(" · ")}
                </span>
              </div>
              {person.level !== "write" && (
                <RequestShareButton personId={person.userId} from="settings" variant="ghost" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyRequests() {
  const t = useTranslations("calendar.sharing");
  const settings = useFormatSettings();
  const requests = useShareRequests();
  const mine = (requests.data ?? []).filter((request) => !request.incoming);
  if (!mine.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t("settings.myRequests")}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {mine.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center gap-x-2 text-ink-soft"
            data-testid="calendar-my-request"
          >
            <span className="font-medium text-ink">{request.name}</span>
            <span>· {t(`levels.${request.approvedLevel ?? request.level}`)}</span>
            <span>· {t(`settings.status.${request.status}`)}</span>
            {request.retryAt && Date.parse(request.retryAt) > Date.now() && (
              <span className="text-xs text-ink-muted">
                {t("settings.retryAt", {
                  when: formatDateTime(new Date(request.retryAt), settings),
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
