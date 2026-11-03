"use client";

import { useCallback, useMemo } from "react";
import { UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { toneSoft, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { useChatMe, useChatPeople } from "./queries";
import type { ChatChannel, ChatPerson } from "./types";

const TONES: readonly Tone[] = ["neutral", "violet", "teal", "gold", "green", "pink"];

export function toTone(value: string | null | undefined): Tone {
  return TONES.includes(value as Tone) ? (value as Tone) : "violet";
}

/**
 * The people of the space by member token, and how a member is called: their
 * name, "Owner" for an owner without one, "Former member" for a record that
 * is gone. The removed keep their name.
 */
export function usePeople() {
  const t = useTranslations("messages");
  const people = useChatPeople();
  const { space } = useChatMe();
  const byMember = useMemo(
    () => new Map((people.data ?? []).map((person) => [person.member, person])),
    [people.data],
  );
  const nameOf = useCallback(
    (member: string | null | undefined) => {
      if (!member) return t("formerMember");
      const person = byMember.get(member);
      if (person?.name) return person.name;
      if (member === space) return t("owner");
      return t("formerMember");
    },
    [byMember, space, t],
  );
  return { people: people.data ?? [], byMember, nameOf, loading: people.isPending };
}

/** What a conversation is called in the list and its header. */
export function useChannelTitle() {
  const t = useTranslations("messages");
  const { nameOf } = usePeople();
  return useCallback(
    (channel: Pick<ChatChannel, "kind" | "name" | "peer">) =>
      channel.kind === "group" ? (channel.name ?? t("group")) : nameOf(channel.peer),
    [nameOf, t],
  );
}

export function PersonAvatar({
  person,
  name,
  className,
}: {
  person: ChatPerson | undefined;
  name: string;
  className?: string;
}) {
  return (
    <Avatar
      src={person?.avatarUrl}
      name={name}
      className={cn(person?.status === "inactive" && "opacity-60 grayscale", className)}
    />
  );
}

export function GroupAvatar({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full border",
        toneSoft[toTone(color)],
        className,
      )}
    >
      <UsersRoundIcon className="size-[45%]" />
    </span>
  );
}

export function ChannelAvatar({
  channel,
  className,
}: {
  channel: Pick<ChatChannel, "kind" | "color" | "peer">;
  className?: string;
}) {
  const { byMember, nameOf } = usePeople();
  if (channel.kind === "group") return <GroupAvatar color={channel.color} className={className} />;
  return (
    <PersonAvatar
      person={channel.peer ? byMember.get(channel.peer) : undefined}
      name={nameOf(channel.peer)}
      className={className}
    />
  );
}
