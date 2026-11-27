"use client";

import { createContext, useContext } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Online status of a person of the company (30.5): online (the app open and
 * used in the last 10 minutes), away (open, 10+ minutes without a touch) or
 * offline with when they were last there. Who may see whom is decided by the
 * database and the presence provider of the app frame; outside it (the
 * public pages, a context without the provider) nobody has a status.
 */
export type PresenceStatus = "online" | "away" | "offline";

export type PersonPresence = {
  status: PresenceStatus;
  /** When they last had the app open, only while offline (null = unknown). */
  lastSeenAt: string | null;
};

type Lookup = (userId: string) => PersonPresence | null;

const PresenceContext = createContext<Lookup>(() => null);

export const PresenceLookupProvider = PresenceContext.Provider;

/** The status of an account in the active company, or null when there is none to show. */
export function usePresenceOf(userId: string | null | undefined): PersonPresence | null {
  const lookup = useContext(PresenceContext);
  return userId ? lookup(userId) : null;
}

/**
 * The dot at a photo: green online, yellow away, nothing offline. Placed by
 * the parent (Avatar puts it at the bottom right).
 */
export function PresenceDot({ status, className }: { status: PresenceStatus; className?: string }) {
  const t = useTranslations("presence");
  if (status === "offline") return null;
  const label = t(status);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-presence={status}
      className={cn(
        "pointer-events-none block size-[30%] min-h-2 min-w-2 rounded-full ring-2 ring-surface",
        status === "online" ? "bg-green" : "bg-gold",
        className,
      )}
    />
  );
}
