"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { activeMemberKeys, fetchActiveMembers } from "./active-members-data";
import { useSession } from "./queries";

export { activeWorkerIds, type ActiveMember } from "./active-members-data";

/** The active members of the active space (or another the account belongs to). */
export function useActiveMembers(space?: string, enabled = true) {
  const { user, spaceId } = useSession();
  const target = space ?? spaceId;
  return useQuery({
    queryKey: activeMemberKeys.space(user.id, target),
    enabled,
    staleTime: 60_000,
    queryFn: () => fetchActiveMembers(createClient(), target),
  });
}
