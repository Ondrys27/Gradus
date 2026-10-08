"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { TimerReading } from "@/features/cold-calling/timer-logic";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { workerKeys } from "../queries";

/** The prospecting timer's reading plus the month, which the worker's dashboard shows. */
export type WorkReading = TimerReading & { monthSeconds: number };

/**
 * One reading of the worker's own timer. Reading applies the idle rule in the
 * database, so a session left open by a closed browser is settled on the next look.
 */
export function useWorkReading() {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: workerKeys.timer(user.id),
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<WorkReading> => {
      const { data, error } = await createClient()
        .rpc("work_status", { _timezone: timeZone })
        .single();
      if (error) throw error;
      return {
        running: data.running,
        todaySeconds: data.today_seconds,
        monthSeconds: data.month_seconds,
        idleDeadline: data.idle_deadline,
        serverNow: data.server_now,
        idleClosedAt: data.idle_closed_at,
        receivedAt: Date.now(),
      };
    },
  });
}

/** Start or pause; nothing else writes work time. Returns whether the pause found it idle. */
export function useWorkAction(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: "start" | "pause"): Promise<{ idleAt: string | null }> => {
      const supabase = createClient();
      if (action === "start") {
        const { error } = await supabase.rpc("start_work_session", { _worker_id: workerId });
        if (error) throw error;
        track("work_timer_started", {});
        return { idleAt: null };
      }
      const { data, error } = await supabase.rpc("pause_work_session", { _worker_id: workerId });
      if (error) throw error;
      const session = data as { end_reason: string | null; ended_at: string | null } | null;
      track("work_timer_paused", { found_idle: session?.end_reason === "idle" });
      return { idleAt: session?.end_reason === "idle" ? session.ended_at : null };
    },
    // Closing a session may have created an hourly earning.
    onSettled: () => queryClient.invalidateQueries({ queryKey: workerKeys.all(user.id) }),
  });
}
