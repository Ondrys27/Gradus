import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BOOKING_LOCALE_COOKIE,
  BOOKING_ZONE_COOKIE,
  bookingLocale,
  type BookingLocale,
} from "../booking/page-locale";
import { isValidTimeZone } from "../zoned";
import { loadManagedBooking } from "../server/bookings";
import {
  loadHostOfProfile,
  loadPublicProfile,
  loadPublicTypes,
  publicType,
  type PublicHost,
  type PublicType,
} from "../server/public-data";
import { siteOrigin } from "@/lib/site-origin";

/**
 * What the public booking pages read on the server (24.4), once per request
 * (React cache): the host with their active types by handle, or a booking by
 * the link's token; and the page's language and the guest's remembered zone
 * from the two cookies the page itself sets.
 */

export type HostPage = { host: PublicHost; types: PublicType[] };

export const loadHostPage = cache(async (handle: string): Promise<HostPage | null> => {
  const admin = createAdminClient();
  const profile = await loadPublicProfile(admin, handle);
  if (!profile) return null;
  const [host, types] = await Promise.all([
    loadHostOfProfile(admin, profile),
    loadPublicTypes(admin, profile.id),
  ]);
  return { host, types: types.map(publicType) };
});

export const loadManagePage = cache(async (token: string) => {
  return loadManagedBooking(createAdminClient(), token, await siteOrigin());
});

export async function pageLocale(fallback: string | null): Promise<BookingLocale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return bookingLocale({
    chosen: cookieStore.get(BOOKING_LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
    hostLocale: fallback,
  });
}

/** The zone the guest picked before, if any (the page falls back to the browser's). */
export async function rememberedZone(): Promise<string | null> {
  const value = (await cookies()).get(BOOKING_ZONE_COOKIE)?.value;
  return value && isValidTimeZone(value) ? value : null;
}
