import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { bookingPath } from "@/features/scheduler/handle";
import { guestFormatSettings } from "@/features/scheduler/booking/guest-format";
import { BookingFlow } from "@/features/scheduler/public/booking-flow";
import { BookingFrame } from "@/features/scheduler/public/booking-frame";
import { InviteCard } from "@/features/scheduler/public/invite-card";
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

/**
 * /s/<handle>/<slug>: book one meeting type (24.4). The invitation on the
 * left, the calendar and times on the right (24.5); on a phone the
 * invitation first, then the steps.
 */
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
    <BookingFrame locale={locale} brandingHidden={host.brandingHidden} ownBrand={host.company ?? host.name}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-6">
          {page.types.length > 1 && (
            <Link
              href={bookingPath(host.profile.handle)}
              className="flex min-h-11 w-fit items-center gap-1 rounded-lg pr-2 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-8"
            >
              <ChevronLeftIcon aria-hidden className="size-4" />
              {t("page.allTypes")}
            </Link>
          )}
          <InviteCard
            host={{ ...host, headline: host.profile.headline }}
            meeting={{
              type,
              duration: t("page.duration", { minutes: formatNumber(type.duration_min, {}, settings) }),
              place,
            }}
            labels={{ meeting: t("page.meeting") }}
          />
        </aside>
        {host.available ? (
          <BookingFlow
            handle={host.profile.handle}
            type={type}
            host={{ name: host.name, country: host.country }}
            hostZone={host.profile.time_zone}
            initialZone={await rememberedZone()}
            brandingHidden={host.brandingHidden}
          />
        ) : (
          <p
            className="rounded-3xl border border-dashed border-line px-5 py-8 text-sm text-ink-muted"
            data-testid="booking-unavailable"
          >
            {t("errors.unavailable")}
          </p>
        )}
      </div>
    </BookingFrame>
  );
}
