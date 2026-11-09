import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRightIcon } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { APP_NAME } from "@/lib/constants";
import { bookingPath } from "@/features/scheduler/handle";
import { guestFormatSettings } from "@/features/scheduler/booking/guest-format";
import { BookingFrame } from "@/features/scheduler/public/booking-frame";
import { HostCard } from "@/features/scheduler/public/host-card";
import { loadHostPage, pageLocale } from "@/features/scheduler/public/page-data";

type Props = { params: Promise<{ handle: string }> };

/** The host's page is the one booking page search engines may index. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const page = await loadHostPage(handle);
  if (!page) return { robots: { index: false, follow: false } };
  const locale = await pageLocale(page.host.locale);
  const t = await getTranslations({ locale, namespace: "booking.meta" });
  return {
    title: t("hostTitle", { name: page.host.name }),
    description: page.host.profile.headline ?? t("hostDescription", { name: page.host.name }),
    robots: page.types.length && page.host.available ? { index: true, follow: false } : { index: false, follow: false },
    applicationName: page.host.brandingHidden ? undefined : APP_NAME,
  };
}

/** /s/<handle>: the host and their active meeting types (24.4). */
export default async function HostBookingPage({ params }: Props) {
  const { handle } = await params;
  const page = await loadHostPage(handle);
  if (!page) notFound();
  const { host, types } = page;
  const locale = await pageLocale(host.locale);
  const t = await getTranslations({ locale, namespace: "booking" });
  const settings = guestFormatSettings(locale, host.profile.time_zone);

  return (
    <BookingFrame locale={locale} brandingHidden={host.brandingHidden}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <HostCard host={{ ...host, headline: host.profile.headline }} />
        {host.profile.bio && <p className="text-sm whitespace-pre-line text-ink-soft">{host.profile.bio}</p>}
        <h1 className="text-xl font-semibold text-ink">{t("page.typesTitle")}</h1>
        {!host.available || types.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted" data-testid="booking-unavailable">
            {host.available ? t("page.noTypes") : t("errors.unavailable")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="booking-types">
            {types.map((type) => (
              <li key={type.id}>
                <Link
                  href={bookingPath(host.profile.handle, type.slug)}
                  className="flex min-h-16 items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3 outline-none hover:border-violet focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-ink">{type.name}</span>
                    <span className="text-sm text-ink-muted">
                      {t("page.duration", { minutes: formatNumber(type.duration_min, {}, settings) })} ·{" "}
                      {t(`page.location.${type.location_kind}`)}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-5 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BookingFrame>
  );
}
