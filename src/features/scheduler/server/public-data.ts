import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { toEventType } from "../event-type-form";
import { isValidHandle, isValidSlug } from "../handle";
import {
  EVENT_TYPE_COLUMNS,
  PROFILE_COLUMNS,
  type EventType,
  type EventTypeRow,
  type SchedulerProfile,
} from "../types";

/**
 * What the public booking page (24.4) shows of a host, read with the admin
 * client because a guest has no session: only for a well formed handle, only
 * the profile with that handle and its active meeting types. Nothing here is
 * secret (no e-mail, no ICS link, no internal ids beyond the type's); the
 * host's e-mail is read separately, only when the server writes to them.
 */

type Admin = SupabaseClient<Database>;

export type PublicHost = {
  profile: SchedulerProfile;
  /** Shown name: the profile's, else the account's. */
  name: string;
  photoUrl: string | null;
  /** The company of the space (its owner's name for it, else the invoicing name). */
  company: string | null;
  /** The host's own language (the page's default) and country (reads a guest's phone). */
  locale: string | null;
  country: string | null;
  /** The space owner's "no branding" add-on: no Gradus logo, no "Made with Gradus". */
  brandingHidden: boolean;
  /**
   * The person still has the scheduler in that space (their own, or an active
   * worker with "scheduler: view" and "own"). Without it the public pages are
   * 404: a worker who left gives nothing of themselves away.
   */
  active: boolean;
  /** Bookable now: active and the space is not read-only. */
  available: boolean;
};

export type PublicType = Pick<
  EventType,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "duration_min"
  | "location_kind"
  | "location_text"
  | "color"
  | "questions"
  | "requires_approval"
  | "max_days_ahead"
>;

export function publicType(type: EventType): PublicType {
  return {
    id: type.id,
    slug: type.slug,
    name: type.name,
    description: type.description,
    duration_min: type.duration_min,
    location_kind: type.location_kind,
    location_text: type.location_text,
    color: type.color,
    questions: type.questions,
    requires_approval: type.requires_approval,
    max_days_ahead: type.max_days_ahead,
  };
}

function must<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

/** The host of a profile (by id): the people around it, branding and whether they can be booked. */
export async function loadHostOfProfile(
  admin: Admin,
  profile: SchedulerProfile,
): Promise<PublicHost> {
  const [account, owner, invoicing, settings, addOn, active, plan] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", profile.user_id)
      .maybeSingle(),
    admin.from("profiles").select("company_name").eq("id", profile.space_id).maybeSingle(),
    admin.from("invoice_profiles").select("name").eq("user_id", profile.space_id).maybeSingle(),
    admin
      .from("user_settings")
      .select("locale, country_code")
      .eq("user_id", profile.user_id)
      .maybeSingle(),
    admin.rpc("account_has_add_on", { _user_id: profile.space_id, _key: "no_branding" }),
    admin.rpc("scheduler_host_active", { _user: profile.user_id, _space: profile.space_id }),
    admin.rpc("current_plan", { _user_id: profile.space_id }),
  ]);
  const accountRow = must(account);
  const name =
    profile.display_name?.trim() || accountRow?.display_name?.trim() || profile.handle;
  return {
    profile,
    name,
    photoUrl: accountRow?.avatar_url || null,
    company: must(owner)?.company_name?.trim() || must(invoicing)?.name?.trim() || null,
    locale: must(settings)?.locale ?? null,
    country: must(settings)?.country_code ?? null,
    brandingHidden: must(addOn) === true,
    active: must(active) === true,
    available: must(active) === true && !must(plan)?.[0]?.read_only,
  };
}

/** The profile with this handle (handles are lower-case), or null. */
export async function loadPublicProfile(
  admin: Admin,
  handle: string,
): Promise<SchedulerProfile | null> {
  const wanted = handle.trim().toLowerCase();
  if (!isValidHandle(wanted)) return null;
  const { data, error } = await admin
    .from("scheduler_profiles")
    .select(PROFILE_COLUMNS)
    .eq("handle", wanted)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The active meeting types of a profile, in their order. */
export async function loadPublicTypes(admin: Admin, profileId: string): Promise<EventType[]> {
  const { data, error } = await admin
    .from("event_types")
    .select(EVENT_TYPE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("active", true)
    .order("position")
    .order("created_at")
    .limit(50);
  if (error) throw error;
  return (data as EventTypeRow[]).map(toEventType);
}

/** One active type of a profile by its slug, with the full row (the slots need it). */
export async function loadPublicTypeRow(
  admin: Admin,
  profileId: string,
  slug: string,
): Promise<EventTypeRow | null> {
  const wanted = slug.trim().toLowerCase();
  if (!isValidSlug(wanted)) return null;
  const { data, error } = await admin
    .from("event_types")
    .select(EVENT_TYPE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("slug", wanted)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data as EventTypeRow | null;
}
