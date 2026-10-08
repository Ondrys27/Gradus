"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { useIsPlaying } from "@/features/game/queries";
import { jarvisOverlay, useJarvisOverlay } from "@/features/jarvis/overlay-store";
import { tourSteps } from "@/features/jarvis/tour";
import { track } from "@/lib/analytics/client";

/** Only new accounts and a restart from Settings need it, so it is not in the app bundle. */
const TourOverlay = dynamic(() => import("./tour-overlay").then((module) => module.TourOverlay), {
  ssr: false,
});

/** Lets the onboarding wizard finish leaving before Jarvis comes in. */
const START_DELAY_MS = 1200;

/**
 * Starts the guided tour once onboarding is done (a worker: on the first
 * visit to their environment) and whenever Settings → Help asks for it.
 * Finishing or skipping stamps profiles.tour_completed_at, so it does not
 * come back by itself.
 */
export function JarvisTour() {
  const { worker } = useSession();
  const profile = useProfile();
  const playing = useIsPlaying();
  const router = useRouter();
  const pathname = usePathname();
  const updateProfile = useUpdateProfile();
  const request = useJarvisOverlay((state) => state.tourRequest);
  const [active, setActive] = useState(false);
  const handledRequest = useRef(request);
  // Started again from Settings → Help rather than after onboarding.
  const replay = useRef(false);

  const due = !profile.tour_completed_at && (Boolean(worker) || !!profile.onboarding_completed_at);
  useEffect(() => {
    if (!due) return;
    const timer = window.setTimeout(() => setActive(true), START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [due]);

  // A restart begins on the dashboard, where the tour starts.
  useEffect(() => {
    if (request === handledRequest.current) return;
    handledRequest.current = request;
    replay.current = true;
    if (pathname !== "/app") router.push("/app");
    setActive(true);
  }, [request, pathname, router]);

  useEffect(() => {
    jarvisOverlay.setTourActive(active);
    return () => jarvisOverlay.setTourActive(false);
  }, [active]);

  const steps = useMemo(() => tourSteps({ worker: Boolean(worker), playing }), [worker, playing]);
  const variant = worker ? "worker" : "owner";
  const onStep = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step) return;
      track("tour_step_viewed", {
        step: step.key,
        index,
        total: steps.length,
        variant,
        replay: replay.current,
      });
    },
    [steps, variant],
  );

  if (!active) return null;
  return (
    <TourOverlay
      steps={steps}
      onStep={onStep}
      onFinish={(how, index) => {
        track("tour_finished", {
          outcome: how === "done" ? "completed" : "skipped",
          step: steps[Math.min(index, steps.length - 1)]?.key ?? "dashboard",
          index,
          total: steps.length,
          variant,
          replay: replay.current,
        });
        setActive(false);
        updateProfile.mutate({ tour_completed_at: new Date().toISOString() });
      }}
    />
  );
}
