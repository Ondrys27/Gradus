import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ClockIcon, MapPinIcon } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { bookingPath } from "@/features/scheduler/handle";
import { guestFormatSettings } from "@/features/scheduler/booking/guest-format";
import { BookingFlow } from "@/features/scheduler/public/booking-flow";
import { BookingFrame } from "@/features/scheduler/public/booking-frame";
import { HostCard } from "@/features/scheduler/public/host-card";
import { loadHostPage, pageLocale, rememberedZone } from "@/features/scheduler/public/page-data";

type Props = { params: Promise<{ handle: string; slug: string }> };

/** A meeting type's page is never indexed (robots); only the host's page is. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const page = await loadHostPage(handle);
  const type = page?.types.find((item) => item.slug === slug.toLowerCase());
  if (!page || !type) return { robots: { index: false, follow: false } };
  const locale = await pageLocale(page.host.locale);
  const t = await getTranslations({ locale, namespace: "booking.meta" });
  return {
    title: t("typeTitle", { type: type.name, name: page.host.name }),
    robots: { index: false, follow: false },
  };
}

/** /s/<handle>/<slug>: book one meeting type (24.4). */
export default async function TypeBookingPage({ params }: Props) {
  const { handle, slug } = await params;
  const page = await loadHostPage(handle);
  const type = page?.types.find((item) => item.slug === slug.toLowerCase());
  if (!page || !type) notFound();
  const { host } = page;
  const locale = await pageLocale(host.locale);
  const t = await getTranslations({ locale, namespace: "booking" });
  const settings = guestFormatSettings(locale, host.profile.time_zone);
  const place =
    type.location_kind === "in_person" || type.location_kind === "custom"
      ? (type.location_text ?? t(`page.location.${type.location_kind}`))
      : t(`page.location.${type.location_kind}`);

  return (
    <BookingFrame locale={locale} brandingHidden={host.brandingHidden}>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5">
          <Link
            href={bookingPath(host.profile.handle)}
            className="flex min-h-11 w-fit items-center gap-1 rounded-xl text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
            {t("page.allTypes")}
          </Link>
          <HostCard host={{ ...host, headline: host.profile.headline }} />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-ink" data-testid="booking-type-name">
              {type.name}
            </h1>
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <ClockIcon aria-hidden className="size-4" />
              {t("page.duration", { minutes: formatNumber(type.duration_min, {}, settings) })}
            </p>
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <MapPinIcon aria-hidden className="size-4" />
              {place}
            </p>
            {type.description && (
              <p className="pt-2 text-sm whitespace-pre-line text-ink-soft">{type.description}</p>
            )}
          </div>
        </aside>
        {host.available ? (
          <BookingFlow
            handle={host.profile.handle}
            type={type}
            host={{ name: host.name, country: host.country }}
            hostZone={host.profile.time_zone}
            initialZone={await rememberedZone()}
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted" data-testid="booking-unavailable">
            {t("errors.unavailable")}
          </p>
        )}
      </div>
    </BookingFrame>
  );
}
