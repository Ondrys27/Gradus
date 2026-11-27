"use client";

import { useState } from "react";
import Image from "next/image";
import { UserRoundIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PresenceDot, usePresenceOf } from "./presence";

/** Up to two initials from a name or e-mail, e.g. "Ondřej Otava" → "OO". */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").split("@")[0].trim();
  if (!clean) return "";
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

/** The largest avatar (size-24), the intrinsic size of the <img>. */
const AVATAR_SOURCE_PX = 96;

export function Avatar({
  src,
  name,
  presenceOf,
  presenceClassName,
  className,
}: {
  src?: string | null;
  /** Used for initials when there is no picture. */
  name?: string | null;
  /**
   * The account of a person of the company: a green (online) or yellow
   * (away) dot at the photo, as far as both show their status (30.5).
   */
  presenceOf?: string | null;
  /** Where the dot sits, when something else takes the bottom right (a camera button). */
  presenceClassName?: string;
  className?: string;
}) {
  const initials = initialsOf(name);
  const presence = usePresenceOf(presenceOf);
  // A picture that does not load (deleted, offline, a refused request) falls
  // back to the initials, never to the browser's broken image; a new address
  // gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const picture = src && failed !== src ? src : null;
  return (
    <span
      className={cn(
        // No overflow-hidden: the presence dot sits over the edge; the picture rounds itself.
        "relative grid size-9 shrink-0 place-items-center rounded-full border border-violet/50 bg-violet/15 text-sm font-semibold text-violet select-none",
        className,
      )}
    >
      {picture ? (
        // The stored file itself (images are not optimised, next.config.ts): 512 px, cropped on upload.
        <Image
          src={picture}
          alt=""
          width={AVATAR_SOURCE_PX}
          height={AVATAR_SOURCE_PX}
          className="size-full rounded-[inherit] object-cover"
          draggable={false}
          data-avatar-image=""
          onError={() => setFailed(picture)}
        />
      ) : initials ? (
        <span aria-hidden>{initials}</span>
      ) : (
        <UserRoundIcon aria-hidden className="size-[45%]" />
      )}
      {presence && (
        <PresenceDot
          status={presence.status}
          className={cn("absolute -right-px -bottom-px", presenceClassName)}
        />
      )}
    </span>
  );
}
