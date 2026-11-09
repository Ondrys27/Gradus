import type { ReactNode } from "react";
import { BookingRoot } from "@/features/scheduler/public/booking-root";
import { loadManagePage, pageLocale } from "@/features/scheduler/public/page-data";

export { rootViewport as viewport } from "@/components/root-document";
export const dynamic = "force-dynamic";

/** Root of the guest's page for one booking: the language they booked in, unless they pick another. */
export default async function ManageBookingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await loadManagePage(token);
  const locale = await pageLocale(ctx?.booking.locale ?? null);
  return <BookingRoot locale={locale}>{children}</BookingRoot>;
}
