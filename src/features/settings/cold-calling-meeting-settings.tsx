"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/features/account/queries";
import { useDurationText } from "@/features/scheduler/ui/common";
import { HOST_MODES, type HostMode, type MeetingSettings } from "@/features/scheduler/meeting-plan";
import { useMeetingSettings, useSaveMeetingSettings } from "@/features/scheduler/meeting-queries";
import { createClient } from "@/lib/supabase/client";
import { SettingRow } from "./ui";

const AUTO = "auto";

type Person = {
  userId: string;
  name: string;
  types: Array<{ id: string; name: string; duration: number }>;
};

/** The people of the owner's company with a scheduler and their active types (the owner reads them all). */
function useSchedulerPeople() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["scheduler", user.id, "meeting-people"],
    queryFn: async (): Promise<Person[]> => {
      const supabase = createClient();
      const [profiles, types, workers] = await Promise.all([
        supabase
          .from("scheduler_profiles")
          .select("user_id, display_name")
          .eq("space_id", user.id)
          .limit(100),
        supabase
          .from("event_types")
          .select("id, user_id, name, duration_min, position")
          .eq("space_id", user.id)
          .eq("active", true)
          .order("position")
          .limit(1000),
        supabase.from("workers").select("user_id, name").eq("owner_id", user.id).limit(500),
      ]);
      for (const result of [profiles, types, workers]) if (result.error) throw result.error;
      const names = new Map(
        (workers.data ?? []).flatMap((worker) =>
          worker.user_id ? [[worker.user_id, worker.name]] : [],
        ),
      );
      return (profiles.data ?? []).map((profile) => ({
        userId: profile.user_id,
        name: names.get(profile.user_id) ?? profile.display_name ?? "",
        types: (types.data ?? [])
          .filter((type) => type.user_id === profile.user_id)
          .map((type) => ({ id: type.id, name: type.name, duration: type.duration_min })),
      }));
    },
  });
}

/**
 * Settings → Work → Cold Calling, the owner's part (30.4): whose meetings the
 * callers book, the default meeting type and whether they may change it,
 * and whether the type's minimum notice counts on the phone.
 */
export function ColdCallingMeetingSettings() {
  const t = useTranslations("settings.coldCalling.meetings");
  const { user } = useSession();
  const durationText = useDurationText();
  const settings = useMeetingSettings();
  const people = useSchedulerPeople();
  const save = useSaveMeetingSettings();
  const state = save.isPending
    ? "saving"
    : save.isError
      ? "failed"
      : save.isSuccess
        ? "saved"
        : null;

  const current = settings.data;
  const fixedHost =
    current?.hostMode === "owner"
      ? user.id
      : current?.hostMode === "person"
        ? current.hostUserId
        : null;
  const hostTypes = useMemo(
    () => people.data?.find((person) => person.userId === fixedHost)?.types ?? [],
    [people.data, fixedHost],
  );

  if (settings.isPending || people.isPending || !current) {
    return <Skeleton className="h-40 rounded-xl" />;
  }

  function change(patch: Partial<MeetingSettings>) {
    const next = { ...current!, ...patch };
    // A type of another host does not carry over.
    if (patch.hostMode !== undefined || patch.hostUserId !== undefined) next.eventTypeId = null;
    if (next.hostMode === "person" && !next.hostUserId) {
      next.hostUserId = people.data?.find((person) => person.userId !== user.id)?.userId ?? null;
      if (!next.hostUserId) next.hostMode = "caller";
    }
    save.mutate(next);
  }

  const others = (people.data ?? []).filter((person) => person.userId !== user.id);
  const modeItems = HOST_MODES.filter((mode) => mode !== "person" || others.length > 0).map(
    (mode) => ({
      value: mode,
      label: t(`hostModes.${mode}`),
    }),
  );

  return (
    <>
      <SettingRow
        id="settings-cold-calling-host"
        label={t("host")}
        hint={t("hostHint")}
        state={state}
      >
        <div className="flex flex-col gap-2">
          <Select
            value={current.hostMode}
            items={modeItems}
            onValueChange={(next) => {
              if (typeof next === "string" && next !== current.hostMode)
                change({ hostMode: next as HostMode });
            }}
          >
            <SelectTrigger id="settings-cold-calling-host" data-testid="settings-cold-calling-host">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current.hostMode === "person" && (
            <Select
              value={current.hostUserId ?? ""}
              items={others.map((person) => ({ value: person.userId, label: person.name }))}
              onValueChange={(next) => {
                if (typeof next === "string" && next !== current.hostUserId)
                  change({ hostUserId: next });
              }}
            >
              <SelectTrigger aria-label={t("person")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {others.map((person) => (
                  <SelectItem key={person.userId} value={person.userId}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {current.hostMode === "owner" && hostTypes.length === 0 && (
            <p className="text-xs text-gold">{t("ownerNoScheduler")}</p>
          )}
        </div>
      </SettingRow>

      {fixedHost && hostTypes.length > 0 && (
        <SettingRow
          id="settings-cold-calling-type"
          label={t("type")}
          hint={t("typeHint")}
          state={state}
        >
          <Select
            value={current.eventTypeId ?? AUTO}
            items={[
              { value: AUTO, label: t("typeAuto") },
              ...hostTypes.map((type) => ({
                value: type.id,
                label: `${type.name} · ${durationText(type.duration)}`,
              })),
            ]}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              save.mutate({ ...current, eventTypeId: next === AUTO ? null : next });
            }}
          >
            <SelectTrigger id="settings-cold-calling-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{t("typeAuto")}</SelectItem>
              {hostTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {`${type.name} · ${durationText(type.duration)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      <SettingRow
        id="settings-cold-calling-type-locked"
        label={t("typeChangeable")}
        hint={t("typeChangeableHint")}
        state={state}
      >
        <Switch
          id="settings-cold-calling-type-locked"
          checked={!current.typeLocked}
          onCheckedChange={(checked) => save.mutate({ ...current, typeLocked: !checked })}
        />
      </SettingRow>

      <SettingRow
        id="settings-cold-calling-notice"
        label={t("ignoreNotice")}
        hint={t("ignoreNoticeHint")}
        state={state}
      >
        <Switch
          id="settings-cold-calling-notice"
          checked={current.ignoreNotice}
          onCheckedChange={(checked) => save.mutate({ ...current, ignoreNotice: checked })}
        />
      </SettingRow>
    </>
  );
}
