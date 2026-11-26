import { pickEventType } from "./event-type-form";

/**
 * Who a meeting booked in the app (30.4: Cold Calling, a contact, a deal,
 * Grady) is for, and of which type. Pure, shared by the server (which
 * decides) and the dialog (which shows the same choice).
 *
 * The owner sets it in Settings → Work → Cold Calling
 * (`cold_calling_meeting_settings`):
 *   * host: "caller" (the caller picks: themselves, and others only with
 *     "cold calling: schedule meetings for others"), "owner" (always the
 *     owner) or "person" (always one person of the company). A fixed host is
 *     the owner's decision, so it needs no right of the caller.
 *   * a default meeting type (of the fixed host) and whether the caller may
 *     change it; without one the type nearest 30 minutes.
 *   * whether the type's minimum notice counts when the time is agreed on
 *     the phone.
 */

export const HOST_MODES = ["caller", "owner", "person"] as const;
export type HostMode = (typeof HOST_MODES)[number];

export type MeetingSettings = {
  hostMode: HostMode;
  hostUserId: string | null;
  eventTypeId: string | null;
  typeLocked: boolean;
  ignoreNotice: boolean;
};

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  hostMode: "caller",
  hostUserId: null,
  eventTypeId: null,
  typeLocked: false,
  ignoreNotice: false,
};

export function parseMeetingSettings(
  row: {
    host_mode: string;
    host_user_id: string | null;
    event_type_id: string | null;
    type_locked: boolean;
    ignore_notice: boolean;
  } | null,
): MeetingSettings {
  if (!row) return { ...DEFAULT_MEETING_SETTINGS };
  return {
    hostMode: (HOST_MODES as readonly string[]).includes(row.host_mode)
      ? (row.host_mode as HostMode)
      : "caller",
    hostUserId: row.host_user_id,
    eventTypeId: row.event_type_id,
    typeLocked: row.type_locked,
    ignoreNotice: row.ignore_notice,
  };
}

/** A person of the company who has the scheduler there (a profile with an active type). */
export type HostCandidate = {
  userId: string;
  types: Array<{ id: string; active: boolean; duration_min: number; position: number }>;
};

export type HostPlan = {
  /** Who may be picked, in order (the default first). */
  hosts: string[];
  /** The one preselected; null = nobody can be booked (see `missing`). */
  defaultHost: string | null;
  /** The caller may pick another host. */
  canPick: boolean;
  /**
   * Why there is nobody: the fixed host has no scheduler yet ("hostMissing"),
   * or the caller themselves has none and may book only for themselves
   * ("selfSetup": the dialog asks for working hours in one step).
   */
  missing: "hostMissing" | "selfSetup" | null;
};

/** Ready = can be booked: a profile with at least one active type. */
function ready(candidate: HostCandidate | undefined): boolean {
  return Boolean(candidate?.types.some((type) => type.active));
}

export function planHosts(input: {
  settings: MeetingSettings;
  ownerId: string;
  callerId: string;
  /** The caller has "schedule meetings for others" (the owner always). */
  canScheduleOthers: boolean;
  candidates: readonly HostCandidate[];
}): HostPlan {
  const { settings, ownerId, callerId } = input;
  const byId = new Map(input.candidates.map((candidate) => [candidate.userId, candidate]));
  const fixed =
    settings.hostMode === "owner"
      ? ownerId
      : settings.hostMode === "person" && settings.hostUserId
        ? settings.hostUserId
        : null;
  if (fixed) {
    if (ready(byId.get(fixed)))
      return { hosts: [fixed], defaultHost: fixed, canPick: false, missing: null };
    // The caller is the fixed host and has no scheduler yet: one step sets it up.
    if (fixed === callerId)
      return { hosts: [], defaultHost: null, canPick: false, missing: "selfSetup" };
    return { hosts: [], defaultHost: null, canPick: false, missing: "hostMissing" };
  }
  const others =
    input.canScheduleOthers || callerId === ownerId
      ? input.candidates
          .filter((candidate) => candidate.userId !== callerId && ready(candidate))
          .map((candidate) => candidate.userId)
      : [];
  const self = ready(byId.get(callerId)) ? [callerId] : [];
  const hosts = [...self, ...others];
  if (!self.length) {
    // Without a scheduler of their own the caller sets one up, or books for someone else.
    return {
      hosts,
      defaultHost: null,
      canPick: hosts.length > 0,
      missing: "selfSetup",
    };
  }
  return { hosts, defaultHost: callerId, canPick: hosts.length > 1, missing: null };
}

/** Whether the caller may book for `host` under the plan. */
export function hostAllowed(plan: HostPlan, host: string): boolean {
  return plan.hosts.includes(host);
}

/**
 * The type preselected for a host: the default of the settings when it is
 * one of the host's active types, else the one nearest 30 minutes.
 */
export function defaultTypeOf(
  candidate: HostCandidate | undefined,
  settings: Pick<MeetingSettings, "eventTypeId">,
): string | null {
  if (!candidate) return null;
  const preset = candidate.types.find((type) => type.id === settings.eventTypeId && type.active);
  if (preset) return preset.id;
  return pickEventType(candidate.types, "meeting")?.id ?? null;
}

/** Whether the caller may book `typeId` for the host (a locked type only the default). */
export function typeAllowed(
  candidate: HostCandidate | undefined,
  settings: Pick<MeetingSettings, "eventTypeId" | "typeLocked">,
  typeId: string,
): boolean {
  if (!candidate?.types.some((type) => type.id === typeId && type.active)) return false;
  if (!settings.typeLocked) return true;
  return defaultTypeOf(candidate, settings) === typeId;
}

/** What the guest's e-mail switch starts as: on when the contact has an address. */
export function emailDefault(contactEmail: string | null | undefined): boolean {
  return Boolean(contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()));
}

/** The guest's name of a contact: the person, else the company. */
export function guestNameOf(contact: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
}): string {
  const person = [contact.first_name, contact.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return (person || contact.company_name?.trim() || "").slice(0, 120);
}
