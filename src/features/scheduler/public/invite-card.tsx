import type { ReactNode } from "react";
import { ClockIcon, MapPinIcon, PhoneIcon, VideoIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { PublicHost, PublicType } from "../server/public-data";

/**
 * The invitation (24.5): the host as a person, and under a hairline the
 * meeting they invite to, what the guest gets out of it, how long and where.
 * A thin line in the brand colours runs along the top, the only ornament.
 * The host's page uses it without a meeting.
 */
export function InviteCard({
  host,
  meeting,
  labels,
  children,
}: {
  host: Pick<PublicHost, "name" | "photoUrl" | "company"> & { headline: string | null };
  meeting?: {
    type: Pick<PublicType, "name" | "description" | "duration_min" | "location_kind">;
    duration: string;
    place: string;
  };
  labels: { meeting: string };
  /** Anything that belongs under the meeting (the host's page puts its bio here). */
  children?: ReactNode;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-line bg-surface"
      data-testid="booking-host"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-violet via-teal to-transparent" />
      <div className="flex flex-col gap-6 p-6 md:p-8">
        <div className="flex items-center gap-4">
          <Avatar
            src={host.photoUrl}
            name={host.name}
            className="size-16 border-line-strong bg-surface-hover text-xl text-ink md:size-20 md:text-2xl"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-display text-2xl leading-tight font-bold tracking-tight text-ink text-balance">
              {host.name}
            </p>
            {host.headline && <p className="text-sm leading-snug text-ink-soft text-pretty">{host.headline}</p>}
            {host.company && <p className="pt-1 text-xs font-medium text-ink-muted">{host.company}</p>}
          </div>
        </div>

        {meeting && (
          <>
            <hr className="border-line/70" />
            <div className="flex flex-col gap-3">
              <p className="micro-label">{labels.meeting}</p>
              <h1
                className="font-display text-3xl leading-[1.05] font-bold tracking-tight text-ink text-balance md:text-4xl"
                data-testid="booking-type-name"
              >
                {meeting.type.name}
              </h1>
              {meeting.type.description && (
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-soft text-pretty">
                  {meeting.type.description}
                </p>
              )}
              <ul className="flex flex-wrap gap-2 pt-1">
                <Chip icon={<ClockIcon aria-hidden />}>{meeting.duration}</Chip>
                <Chip icon={<PlaceIcon kind={meeting.type.location_kind} />}>{meeting.place}</Chip>
              </ul>
            </div>
          </>
        )}
        {children}
      </div>
    </section>
  );
}

export function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-canvas/50 px-3 text-xs font-semibold text-ink [&_svg]:size-3.5 [&_svg]:text-teal">
      {icon}
      {children}
    </li>
  );
}

export function PlaceIcon({ kind }: { kind: PublicType["location_kind"] }) {
  if (kind === "video") return <VideoIcon aria-hidden />;
  if (kind === "phone") return <PhoneIcon aria-hidden />;
  return <MapPinIcon aria-hidden />;
}
