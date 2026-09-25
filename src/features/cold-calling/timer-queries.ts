"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { TimerReading } from "./timer-logic";

export const coldCallingKeys = {
  all: (userId: string) => ["cold-calling", userId] as const,
  timer: (userId: string) => ["cold-calling", userId, "timer"] as const,
};

/**
 * One reading of the timer. Reading applies the idle rule in the database, so a
 * segment left open by a closed browser is settled the next time anyone looks.
 */
export function useTimerReading() {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: coldCallingKeys.timer(user.id),
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<TimerReading> => {
      const { data, error } = await createClient()
        .rpc("prospecting_status", { _timezone: timeZone })
        .single();
      if (error) throw error;
      return {
        running: data.running,
        todaySeconds: data.today_seconds,
        idleDeadline: data.idle_deadline,
        serverNow: data.server_now,
        idleClosedAt: data.idle_closed_at,
        receivedAt: Date.now(),
      };
    },
  });
}

/** Start or pause; nothing else writes the timer. Returns whether the pause found it idle. */
export function useTimerAction() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: "start" | "pause"): Promise<{ idleAt: string | null }> => {
      const supabase = createClient();
      if (action === "start") {
        const { error } = await supabase.rpc("start_prospecting");
        if (error) throw error;
        return { idleAt: null };
      }
      const { data, error } = await supabase.rpc("pause_prospecting");
      if (error) throw error;
      const segment = data as { end_reason: string | null; ended_at: string | null } | null;
      return { idleAt: segment?.end_reason === "idle" ? segment.ended_at : null };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: coldCallingKeys.timer(user.id) }),
  });
}
