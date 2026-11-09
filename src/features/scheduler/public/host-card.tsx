import { Avatar } from "@/components/ui/avatar";
import type { PublicHost } from "../server/public-data";

/** The host as the booking page introduces them: photo, name, headline, company. */
export function HostCard({ host }: { host: Pick<PublicHost, "name" | "photoUrl" | "company"> & { headline: string | null } }) {
  return (
    <div className="flex items-center gap-4" data-testid="booking-host">
      <Avatar src={host.photoUrl} name={host.name} className="size-14 text-lg" />
      <div className="flex min-w-0 flex-col">
        <p className="truncate text-lg font-semibold text-ink">{host.name}</p>
        {host.headline && <p className="text-sm text-ink-soft">{host.headline}</p>}
        {host.company && <p className="text-sm text-ink-muted">{host.company}</p>}
      </div>
    </div>
  );
}
