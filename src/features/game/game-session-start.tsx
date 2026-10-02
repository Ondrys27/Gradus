"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/features/account/queries";
import { useAwardXp } from "./queries";

/**
 * Mounted once for the whole app: claims today's login XP. award_xp() pays it
 * once per day in the user's zone and nothing in tool mode, so a reload or a
 * second tab is free. A worker's account has no game of its own.
 */
export function GameSessionStart() {
  const { worker } = useSession();
  const awardXp = useAwardXp();
  const claimed = useRef(false);

  useEffect(() => {
    if (worker || claimed.current) return;
    claimed.current = true;
    awardXp.mutate({ reason: "daily_login" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per app start
  }, [worker]);

  return null;
}
