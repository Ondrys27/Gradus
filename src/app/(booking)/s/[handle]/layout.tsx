import type { ReactNode } from "react";
import { BookingRoot } from "@/features/scheduler/public/booking-root";
import { loadHostPage, pageLocale } from "@/features/scheduler/public/page-data";

export { rootViewport as viewport } from "@/components/root-document";
export const dynamic = "force-dynamic";

/** Root of a host's public booking pages: their language unless the guest's browser or pick says otherwise. */
export default async function HostBookingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const page = await loadHostPage(handle);
  const locale = await pageLocale(page?.host.locale ?? null);
  return <BookingRoot locale={locale}>{children}</BookingRoot>;
}
