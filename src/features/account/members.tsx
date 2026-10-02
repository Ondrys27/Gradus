"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useSession } from "./queries";
import { useWorkspace } from "./workspace-queries";

/** An account that works in the owner's space, as the owner sees it. */
export type WorkspaceMember = {
  userId: string;
  workerId: string;
  name: string;
  avatarUrl: string | null;
};

/** A space has a handful of workers; this only bounds the query. */
const MEMBER_LIMIT = 100;

export const memberKeys = {
  // Under "workers", so saving a worker refreshes the names too.
  all: (userId: string) => ["workers", userId, "members"] as const,
};

/**
 * The owner's workers that have an account, by account id: who did what in the
 * space. Empty for a worker, who sees only their own numbers anyway.
 */
export function useWorkspaceMembers() {
  const { user } = useSession();
  const workspace = useWorkspace();
  const isOwner = workspace.role === "owner";
  return useQuery({
    queryKey: memberKeys.all(user.id),
    enabled: isOwner,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, WorkspaceMember>> => {
      const supabase = createClient();
      const { data: workers, error } = await supabase
        .from("workers")
        .select("id, user_id, name")
        .eq("owner_id", user.id)
        .not("user_id", "is", null)
        .order("created_at")
        .limit(MEMBER_LIMIT);
      if (error) throw error;
      const ids = workers.flatMap((worker) => (worker.user_id ? [worker.user_id] : []));
      if (ids.length === 0) return new Map();
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, avatar_url, display_name")
        .in("id", ids);
      if (profileError) throw profileError;
      const byId = new Map(profiles.map((profile) => [profile.id, profile]));
      return new Map(
        workers.flatMap((worker) => {
          if (!worker.user_id) return [];
          const profile = byId.get(worker.user_id);
          return [
            [
              worker.user_id,
              {
                userId: worker.user_id,
                workerId: worker.id,
                name: worker.name || profile?.display_name || "",
                avatarUrl: profile?.avatar_url ?? null,
              },
            ] as const,
          ];
        }),
      );
    },
  });
}

/**
 * The avatar of the worker who did something, for the owner. Nothing for the
 * owner's own actions, for a worker's view, or for an unknown account.
 */
export function ActorAvatar({
  actorId,
  className,
}: {
  actorId: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations("workspace");
  const { user } = useSession();
  const members = useWorkspaceMembers();
  if (!actorId || actorId === user.id) return null;
  const member = members.data?.get(actorId);
  if (!member) return null;
  const label = t("doneBy", { name: member.name });
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0">
      <Avatar
        src={member.avatarUrl}
        name={member.name}
        className={cn("size-6 text-[10px]", className)}
      />
    </span>
  );
}
