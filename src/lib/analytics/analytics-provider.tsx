"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { flush, track } from "./client";
import { routeOf, sectionOf } from "./routes";
import { scrubMessage } from "./scrub";

/** The heartbeat's rhythm; a session counts only the minutes with one. */
export const HEARTBEAT_MS = 60_000;

/** An error the app caught (error boundary) or the window saw, without any data in it. */
export function reportClientError(
  error: unknown,
  source: "boundary" | "onerror" | "unhandledrejection",
): void {
  try {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === "string"
          ? error
          : "unknown";
    track("client_error", {
      route: routeOf(window.location.pathname),
      source,
      message: scrubMessage(message),
    });
  } catch {
    // Reporting an error must not cause another.
  }
}

/** How long the first page took to load, from the browser's own timing. */
function initialLoadMs(): number | undefined {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const value = entry?.domContentLoadedEventEnd || entry?.domInteractive || 0;
    return value > 0 && value < 86_400_000 ? Math.round(value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Measures the signed-in app: a page view on every route change, the
 * once-a-minute heartbeat (only while the tab is visible and the person did
 * something in the last minute) and errors the window reports.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    const route = routeOf(pathname);
    const initial = first.current;
    first.current = false;
    track("page_viewed", {
      route,
      section: sectionOf(route),
      initial,
      ...(initial ? { load_ms: initialLoadMs() } : {}),
    });
  }, [pathname]);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    track("app_opened", { ref: ref === "email" ? "email" : "direct" });

    let lastActivity = Date.now();
    const markActive = () => {
      lastActivity = Date.now();
    };
    const activityEvents = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const name of activityEvents) {
      window.addEventListener(name, markActive, { passive: true, capture: true });
    }
    // Moving the mouse counts too, checked at most once a second.
    let lastMove = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove > 1000) {
        lastMove = now;
        markActive();
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const beat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivity > HEARTBEAT_MS) return;
      flush({ heartbeat: true });
    }, HEARTBEAT_MS);

    const onError = (event: ErrorEvent) =>
      reportClientError(event.error ?? event.message, "onerror");
    const onRejection = (event: PromiseRejectionEvent) =>
      reportClientError(event.reason, "unhandledrejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.clearInterval(beat);
      for (const name of activityEvents) {
        window.removeEventListener(name, markActive, { capture: true });
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
