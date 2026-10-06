"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { useIsPlaying } from "@/features/game/queries";
import { jarvisOverlay, useJarvisOverlay } from "@/features/jarvis/overlay-store";
import { tourSteps } from "@/features/jarvis/tour";

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
    if (pathname !== "/app") router.push("/app");
    setActive(true);
  }, [request, pathname, router]);

  useEffect(() => {
    jarvisOverlay.setTourActive(active);
    return () => jarvisOverlay.setTourActive(false);
  }, [active]);

  const steps = useMemo(() => tourSteps({ worker: Boolean(worker), playing }), [worker, playing]);

  if (!active) return null;
  return (
    <TourOverlay
      steps={steps}
      onFinish={() => {
        setActive(false);
        updateProfile.mutate({ tour_completed_at: new Date().toISOString() });
      }}
    />
  );
}
