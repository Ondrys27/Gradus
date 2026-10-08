"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_LOGIN_PATH, idleStep } from "./access";
import { adminHeartbeat, endAdminSession } from "./server/login-actions";

const TICK_MS = 15_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

async function leave() {
  // The server ends an idle or expired session by itself; this only makes it immediate.
  await endAdminSession().catch(() => undefined);
  window.location.replace(ADMIN_LOGIN_PATH);
}

/**
 * Leaves the administration after 30 minutes without input and at the
 * 8-hour limit. Input is reported to the server every few minutes, so reading
 * a long table without changing pages is not idleness. The database enforces
 * the same limits on every request; this keeps the screen honest.
 */
export function AdminIdleGuard({ expiresAt }: { expiresAt: string }) {
  const lastActivity = useRef(0);
  const lastHeartbeat = useRef(0);
  const expiry = useRef(new Date(expiresAt).getTime());

  useEffect(() => {
    const now = Date.now();
    lastActivity.current = now;
    lastHeartbeat.current = now;
    let leaving = false;

    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const tick = () => {
      if (leaving) return;
      const step = idleStep({
        now: Date.now(),
        lastActivity: lastActivity.current,
        lastHeartbeat: lastHeartbeat.current,
        expiresAt: expiry.current,
      });
      if (step === "end") {
        leaving = true;
        void leave();
      } else if (step === "heartbeat") {
        lastHeartbeat.current = Date.now();
        void adminHeartbeat()
          .then((result) => {
            if (!result.ok) {
              leaving = true;
              void leave();
            }
          })
          .catch(() => undefined);
      }
    };

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    // A laptop waking from sleep checks at once instead of at the next tick.
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}

export function AdminSignOutButton() {
  const t = useTranslations("admin.shell");
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void leave();
      }}
    >
      <LogOutIcon aria-hidden />
      {t("signOut")}
    </Button>
  );
}
