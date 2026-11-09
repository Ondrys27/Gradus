"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClockIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserSettings } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { grantAllows } from "@/features/workers/permissions-catalog";
import { cn } from "@/lib/utils";
import type { EventTypeDraft } from "../event-type-form";
import {
  SchedulerActionError,
  useBookingCounts,
  useDeleteEventType,
  useEnsureSetup,
  useEventTypes,
  useSchedulerProfile,
  useTeamScheduler,
  useToggleEventType,
  useTypesLimit,
  writeProblem,
} from "../queries";
import {
  DEFAULT_QUESTIONS,
  DEFAULT_REMINDERS,
  SCHEDULER_TABS,
  type EventType,
  type SchedulerProfile,
  type SchedulerTab,
} from "../types";
import { AvailabilityTab } from "./availability-tab";
import { BookingsTab } from "./bookings-tab";
import { bookingLink, CopyLinkButton, PlanLimitNotice } from "./common";
import { EventTypeCard } from "./event-type-card";
import { EventTypeEditor } from "./event-type-editor";
import { ProfileDialog } from "./profile-dialog";
import { SetupGuide } from "./setup-guide";

type Editing = { type: EventType } | { draft: EventTypeDraft } | null;

function newDraft(): EventTypeDraft {
  return {
    name: "",
    slug: "",
    description: null,
    duration_min: 30,
    location_kind: "video",
    location_text: null,
    color: "violet",
    requires_approval: false,
    buffer_before_min: 0,
    buffer_after_min: 0,
    min_notice_hours: 4,
    max_days_ahead: 60,
    max_per_day: null,
    slot_step_min: 30,
    custom_availability: false,
    questions: DEFAULT_QUESTIONS.map((question) => ({ ...question })),
    reminders: DEFAULT_REMINDERS.map((reminder) => ({ ...reminder })),
    deal_stage_id: null,
    confirmation_note: null,
  };
}

/**
 * Scheduler (/app/planovac): the person's meeting types, availability and
 * bookings; the owner of the space also sees everyone of the company. The
 * first open sets up the profile, three types and working hours, then a
 * guide asks for the handle, the video link and the hours.
 */
export function SchedulerView({ initialTab = "types" }: { initialTab?: SchedulerTab }) {
  const t = useTranslations("scheduler");
  const tNav = useTranslations("nav");
  const workspace = useWorkspace();
  const owner = workspace.role === "owner";
  const canOwn = owner || grantAllows(workspace.grants, "scheduler", "own");
  const editable = canOwn && !workspace.readOnly;
  const profile = useSchedulerProfile();
  const ensure = useEnsureSetup();
  const started = useRef(false);

  const tabs = SCHEDULER_TABS.filter((tab) => tab !== "team" || owner);
  const [tab, setTabState] = useState<SchedulerTab>(
    tabs.includes(initialTab) ? initialTab : "types",
  );
  function setTab(next: SchedulerTab) {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }

  // The first open makes the profile, the three types and the hours (once per view).
  const presetNames = useMemo(
    () => ({
      intro: t("presets.intro"),
      consultation: t("presets.consultation"),
      meeting: t("presets.meeting"),
    }),
    [t],
  );
  const needsSetup = profile.data === null;
  useEffect(() => {
    if (!editable || started.current || profile.isPending || profile.isError || !needsSetup) return;
    started.current = true;
    ensure.mutate(presetNames);
  }, [editable, profile.isPending, profile.isError, needsSetup, ensure, presetNames]);

  const header = (actions?: React.ReactNode) => (
    <PageHeader title={tNav("scheduler")} description={t("description")} actions={actions} />
  );

  if (!canOwn) {
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <EmptyState
          icon={<CalendarClockIcon aria-hidden />}
          title={t("noRight.title")}
          description={t("noRight.text")}
        />
      </div>
    );
  }
  if (
    profile.isPending ||
    (profile.data === null &&
      (ensure.isPending || (editable && !ensure.isError && !ensure.isSuccess)))
  ) {
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    );
  }
  if (profile.isError || (profile.data === null && ensure.isError)) {
    const readOnly =
      ensure.error instanceof SchedulerActionError && ensure.error.code === "readOnly";
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <FormAlert>{readOnly ? t("readOnly") : t("loadFailed")}</FormAlert>
      </div>
    );
  }
  if (!profile.data) {
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <EmptyState
          icon={<CalendarClockIcon aria-hidden />}
          title={t("empty.title")}
          description={t("readOnly")}
        />
      </div>
    );
  }
  return (
    <Loaded
      profile={profile.data}
      editable={editable}
      owner={owner}
      tab={tab}
      tabs={tabs}
      setTab={setTab}
      header={header}
    />
  );
}

function Loaded({
  profile,
  editable,
  owner,
  tab,
  tabs,
  setTab,
  header,
}: {
  profile: SchedulerProfile;
  editable: boolean;
  owner: boolean;
  tab: SchedulerTab;
  tabs: SchedulerTab[];
  setTab: (tab: SchedulerTab) => void;
  header: (actions?: React.ReactNode) => React.ReactNode;
}) {
  const t = useTranslations("scheduler");
  const settings = useUserSettings();
  const types = useEventTypes(profile.id);
  const counts = useBookingCounts();
  const limit = useTypesLimit();
  const toggle = useToggleEventType();
  const remove = useDeleteEventType();
  const team = useTeamScheduler(owner);
  const [editing, setEditing] = useState<Editing>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const list = useMemo(() => types.data ?? [], [types.data]);
  const activeCount = list.filter((type) => type.active).length;
  const limitValue = limit.data ?? null;
  const roomForActive = limitValue === null || activeCount < limitValue;

  const typeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of list) map.set(type.id, type.name);
    for (const person of team.data ?? [])
      for (const type of person.types) map.set(type.id, type.name);
    return map;
  }, [list, team.data]);
  const hostNames = useMemo(
    () =>
      new Map((team.data ?? []).map((person) => [person.user_id, person.name ?? person.handle])),
    [team.data],
  );

  const editingType =
    editing && "type" in editing
      ? (list.find((type) => type.id === editing.type.id) ?? editing.type)
      : null;
  const otherSlugs = list.filter((type) => type.id !== editingType?.id).map((type) => type.slug);

  return (
    <div className="flex flex-col gap-6">
      {header(
        editable && tab === "types" ? (
          <Button onClick={() => setEditing({ draft: newDraft() })}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("newType")}
          </Button>
        ) : undefined,
      )}

      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "relative min-h-11 shrink-0 cursor-pointer px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              tab === key
                ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet after:content-['']"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "types" && (
        <div className="flex flex-col gap-6">
          {editable && !profile.setup_done_at && (
            <SetupGuide profile={profile} onOpenHours={() => setTab("availability")} />
          )}

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="micro-label">{t("link.label")}</span>
              <span className="truncate text-sm text-ink" data-testid="scheduler-link">
                {bookingLink(profile.handle)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyLinkButton handle={profile.handle} from="card" />
              {editable && (
                <Button variant="ghost" size="sm" onClick={() => setProfileOpen(true)}>
                  <PencilIcon aria-hidden />
                  {t("profile.edit")}
                </Button>
              )}
            </div>
          </section>

          {toggle.isError && writeProblem(toggle.error) === "planLimit" && (
            <PlanLimitNotice limit={limitValue} />
          )}
          {toggle.isError && writeProblem(toggle.error) !== "planLimit" && (
            <FormAlert>{t("toggleFailed")}</FormAlert>
          )}
          {!roomForActive &&
            limitValue !== null &&
            activeCount >= limitValue &&
            list.length > activeCount && (
              <p className="text-sm text-ink-muted">{t("planLimit.note", { count: limitValue })}</p>
            )}

          {types.isPending ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-36 rounded-2xl" />
              <Skeleton className="h-36 rounded-2xl" />
            </div>
          ) : types.isError ? (
            <FormAlert>{t("loadFailed")}</FormAlert>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<CalendarClockIcon aria-hidden />}
              title={t("empty.title")}
              description={t("empty.text")}
              action={
                editable && (
                  <Button onClick={() => setEditing({ draft: newDraft() })}>
                    <PlusIcon aria-hidden data-icon="inline-start" />
                    {t("newType")}
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((type) => (
                <EventTypeCard
                  key={type.id}
                  type={type}
                  handle={profile.handle}
                  bookings={counts.data?.get(type.id) ?? 0}
                  canToggle={editable}
                  toggling={toggle.isPending && toggle.variables?.type.id === type.id}
                  onToggle={(active) => toggle.mutate({ type, active })}
                  onOpen={() => setEditing({ type })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "availability" && <AvailabilityTab profile={profile} editable={editable} />}

      {tab === "bookings" && (
        <BookingsTab
          typeNames={typeNames}
          hostNames={hostNames}
          canSeeTeam={owner}
          country={settings.country_code ?? null}
        />
      )}

      {tab === "team" && owner && (
        <TeamTab
          loading={team.isPending}
          failed={team.isError}
          people={team.data ?? []}
          counts={counts.data}
          toggling={toggle.isPending ? (toggle.variables?.type.id ?? null) : null}
          onDeactivate={(type) => toggle.mutate({ type, active: false })}
          canChange={editable}
        />
      )}

      <EventTypeEditor
        open={editing !== null}
        type={editingType}
        draft={editing && "draft" in editing ? editing.draft : null}
        profile={profile}
        otherSlugs={otherSlugs}
        startActive={roomForActive}
        limit={limitValue}
        editable={editable}
        position={list.length}
        onClose={() => setEditing(null)}
        onCreated={(created) => setEditing({ type: created })}
        onDelete={
          editingType && editable
            ? () => remove.mutate(editingType.id, { onSuccess: () => setEditing(null) })
            : undefined
        }
        deleting={remove.isPending}
      />
      <ProfileDialog profile={profile} open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}

function TeamTab({
  loading,
  failed,
  people,
  counts,
  toggling,
  onDeactivate,
  canChange,
}: {
  loading: boolean;
  failed: boolean;
  people: Array<SchedulerProfile & { name: string | null; types: EventType[] }>;
  counts: Map<string, number> | undefined;
  toggling: string | null;
  onDeactivate: (type: EventType) => void;
  canChange: boolean;
}) {
  const t = useTranslations("scheduler.team");
  if (loading) return <Skeleton className="h-48 rounded-2xl" />;
  if (failed) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!people.length) {
    return (
      <EmptyState
        icon={<CalendarClockIcon aria-hidden />}
        title={t("emptyTitle")}
        description={t("emptyText")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <p className="text-[13px] text-ink-muted">{t("hint")}</p>
      {people.map((person) => (
        <section
          key={person.id}
          className="flex flex-col gap-3"
          aria-label={person.name ?? person.handle}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">{person.name ?? person.handle}</h2>
            <span className="text-xs text-ink-muted">{bookingLink(person.handle)}</span>
          </header>
          {person.types.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("noTypes")}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {person.types.map((type) => (
                <EventTypeCard
                  key={type.id}
                  type={type}
                  handle={person.handle}
                  bookings={counts?.get(type.id) ?? 0}
                  canToggle={canChange && type.active}
                  offOnly
                  toggling={toggling === type.id}
                  onToggle={(active) => !active && onDeactivate(type)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
