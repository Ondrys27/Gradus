"use client";

import { Avatar } from "@/components/ui/avatar";
import { useActiveMembers } from "./active-members";

/**
 * The photo of a person of the active company by their account id, with the
 * online dot (30.5): the one face of a person on a deal, a task or a filter.
 * The name is the caller's ("Já", a former member…); the picture comes from
 * the shared list of active members, initials when there is none.
 */
export function MemberAvatar({
  userId,
  name,
  className,
}: {
  userId: string | null | undefined;
  name: string;
  className?: string;
}) {
  const members = useActiveMembers();
  const member = userId ? members.data?.find((person) => person.userId === userId) : undefined;
  return (
    <Avatar
      src={member?.avatarUrl}
      name={name}
      presenceOf={member ? member.userId : null}
      className={className}
    />
  );
}
