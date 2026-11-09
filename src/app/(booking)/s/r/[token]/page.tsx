import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { guestCanManage } from "@/features/scheduler/booking/state";
import { BookingFrame } from "@/features/scheduler/public/booking-frame";
import { ManageView } from "@/features/scheduler/public/manage-view";
import { loadManagePage, pageLocale } from "@/features/scheduler/public/page-data";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ cancel?: string }>;
};

/** The link carries the secret: never indexed, never sent on as a referrer. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const ctx = await loadManagePage(token);
  const locale = await pageLocale(ctx?.booking.locale ?? null);
  const t = await getTranslations({ locale, namespace: "booking.meta" });
  return {
    title: t("manageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** /s/r/<token>: the guest moves or cancels their booking (24.4). */
export default async function ManageBookingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { cancel } = await searchParams;
  const ctx = await loadManagePage(token);
  if (!ctx || !ctx.booking.guest_email) notFound();
  const locale = await pageLocale(ctx.booking.locale);
  const { booking } = ctx;
  const status = booking.status as "pending" | "confirmed" | "cancelled" | "declined";
  const live = guestCanManage(booking, Date.now()) && Boolean(ctx.host?.available);

  return (
    <BookingFrame locale={locale} brandingHidden={Boolean(ctx.host?.brandingHidden)}>
      <div className="mx-auto w-full max-w-3xl">
        <ManageView
          token={token}
          startWithCancel={cancel === "1"}
          booking={{
            typeName: ctx.type?.name ?? "",
            durationMin: Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000),
            startsAt: booking.starts_at,
            status,
            hostName: ctx.host?.name ?? "",
            videoLink: status === "confirmed" && ctx.type?.location_kind === "video" ? (ctx.profile?.video_link ?? null) : null,
            guestZone: booking.guest_time_zone ?? ctx.profile?.time_zone ?? "Europe/Prague",
            canManage: live,
          }}
        />
      </div>
    </BookingFrame>
  );
}
