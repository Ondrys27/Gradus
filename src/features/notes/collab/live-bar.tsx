"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { typingLabel } from "./people";
import type { CollabColor } from "./provider";
import type { SessionSnapshot } from "./session";

const RING: Record<CollabColor, string> = {
  violet: "ring-violet",
  teal: "ring-teal",
  gold: "ring-gold",
  green: "ring-green",
  orange: "ring-orange",
  pink: "ring-pink",
};

const MAX_FACES = 5;

/** The faces of the people who have the note open right now, each in their cursor colour. */
export function LivePeople({ snapshot, className }: { snapshot: SessionSnapshot; className?: string }) {
  const t = useTranslations("notes.live");
  const people = snapshot.people;
  if (people.length === 0) return null;
  const faces = people.slice(0, MAX_FACES);
  const more = people.length - faces.length;
  return (
    <span
      className={cn("flex shrink-0 items-center -space-x-1.5 px-1", className)}
      data-testid="note-live-people"
      data-count={people.length}
      title={t("here", { names: people.map((person) => person.name).join(", ") })}
      aria-label={t("here", { names: people.map((person) => person.name).join(", ") })}
    >
      {faces.map((person) => (
        <span key={person.userId} data-testid="note-live-person" data-writer={person.writer ? "true" : "false"}>
          <Avatar
            src={person.avatarUrl}
            name={person.name}
            className={cn("size-6 text-[10px] ring-2 ring-offset-1 ring-offset-canvas", RING[person.color])}
          />
        </span>
      ))}
      {more > 0 && (
        <span className="grid size-6 place-items-center rounded-full bg-surface text-[10px] text-ink-soft ring-2 ring-canvas">
          +{more}
        </span>
      )}
    </span>
  );
}

/** Saving and the connection, quietly next to the date; "Píše Váša…" while someone types. */
export function LiveStatus({ snapshot }: { snapshot: SessionSnapshot }) {
  const t = useTranslations("notes.live");
  const status = snapshot.save;
  const offline = status === "offline";
  const warn = status === "error" || offline || status === "tooLarge" || status === "denied";
  const typing = typingLabel(snapshot.typing, (key, values) => t(`typing.${key}`, values));
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        data-testid="note-save-status"
        data-status={status}
        data-connection={snapshot.connection}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs transition-colors",
          warn ? "text-orange" : "text-ink-muted",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status === "saved"
              ? "bg-green/70"
              : warn
                ? "bg-orange"
                : "animate-pulse bg-ink-muted motion-reduce:animate-none",
          )}
        />
        {t(`status.${status}`)}
      </span>
      {typing && (
        <>
          <span className="mx-2">·</span>
          <span className="text-xs text-teal" data-testid="note-live-typing" aria-live="polite">
            {typing}
          </span>
        </>
      )}
    </>
  );
}

/** Why the note can not be written now, when it is a limit or the access ended. */
export function LiveNotice({ snapshot }: { snapshot: SessionSnapshot }) {
  const t = useTranslations("notes.live");
  const message =
    snapshot.phase === "gone"
      ? t("gone")
      : snapshot.limit === "people"
        ? t("limitPeople", { max: 10 })
        : snapshot.limit === "size"
          ? t("limitSize")
          : null;
  if (!message) return null;
  return (
    <p
      role="status"
      data-testid="note-live-limit"
      data-reason={snapshot.phase === "gone" ? "gone" : (snapshot.limit ?? undefined)}
      className="mb-3 flex items-center gap-2 rounded-xl bg-orange/10 px-3 py-2 text-xs text-orange"
    >
      <InfoIcon aria-hidden className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}
