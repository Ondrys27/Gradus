import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRightIcon, ClockIcon } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { APP_NAME } from "@/lib/constants";
import { bookingPath } from "@/features/scheduler/handle";
import { guestFormatSettings } from "@/features/scheduler/booking/guest-format";
import { BookingFrame } from "@/features/scheduler/public/booking-frame";
import { Chip, InviteCard, PlaceIcon } from "@/features/scheduler/public/invite-card";
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

/**
 * /s/<handle>: the host and their active meeting types (24.4). The
 * invitation with the host's bio on the left, the meetings to pick from on
 * the right (24.5).
 */
export default async function HostBookingPage({ params }: Props) {
  const { handle } = await params;
  const page = await loadHostPage(handle);
  if (!page) notFound();
  const { host, types } = page;
  const locale = await pageLocale(host.locale);
  const t = await getTranslations({ locale, namespace: "booking" });
  const settings = guestFormatSettings(locale, host.profile.time_zone);

  return (
    <BookingFrame locale={locale} brandingHidden={host.brandingHidden} ownBrand={host.company ?? host.name}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-6">
          <InviteCard host={{ ...host, headline: host.profile.headline }} labels={{ meeting: t("page.meeting") }}>
            {host.profile.bio && (
              <>
                <hr className="border-line/70" />
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-soft text-pretty">
                  {host.profile.bio}
                </p>
              </>
            )}
          </InviteCard>
        </aside>
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">{t("page.typesTitle")}</h1>
          {!host.available || types.length === 0 ? (
            <p
              className="rounded-3xl border border-dashed border-line px-5 py-8 text-sm text-ink-muted"
              data-testid="booking-unavailable"
            >
              {host.available ? t("page.noTypes") : t("errors.unavailable")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="booking-types">
              {types.map((type) => {
                const place =
                  type.location_kind === "in_person" || type.location_kind === "custom"
                    ? (type.location_text ?? t(`page.location.${type.location_kind}`))
                    : t(`page.location.${type.location_kind}`);
                return (
                  <li key={type.id}>
                    <Link
                      href={bookingPath(host.profile.handle, type.slug)}
                      className="group flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 outline-none transition-colors hover:border-line-strong hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 md:p-6"
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span className="font-display text-xl leading-tight font-bold tracking-tight text-ink text-balance md:text-2xl">
                          {type.name}
                        </span>
                        <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-soft transition-colors group-hover:border-violet group-hover:bg-violet group-hover:text-white mouse:size-9">
                          <ArrowRightIcon aria-hidden className="size-4" />
                        </span>
                      </span>
                      {type.description && (
                        <span className="line-clamp-3 text-sm leading-relaxed text-ink-soft text-pretty">
                          {type.description}
                        </span>
                      )}
                      <ul className="flex flex-wrap gap-2">
                        <Chip icon={<ClockIcon aria-hidden />}>
                          {t("page.duration", { minutes: formatNumber(type.duration_min, {}, settings) })}
                        </Chip>
                        <Chip icon={<PlaceIcon kind={type.location_kind} />}>{place}</Chip>
                      </ul>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </BookingFrame>
  );
}
