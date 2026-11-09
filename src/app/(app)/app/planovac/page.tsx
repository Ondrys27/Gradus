import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SCHEDULER_TABS, type SchedulerTab } from "@/features/scheduler/types";
import { SchedulerView } from "@/features/scheduler/ui/scheduler-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("scheduler") };
}

export default async function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; booking?: string | string[] }>;
}) {
  const { tab, booking } = await searchParams;
  const initialTab = (SCHEDULER_TABS as readonly string[]).includes(String(tab))
    ? (tab as SchedulerTab)
    : "types";
  // A booking from the host's e-mail or Jarvis opens on the Bookings tab.
  const bookingId =
    typeof booking === "string" && /^[0-9a-f-]{36}$/i.test(booking) ? booking : null;
  return (
    <SchedulerView initialTab={bookingId ? "bookings" : initialTab} initialBooking={bookingId} />
  );
}
