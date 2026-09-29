"use client";

import dynamic from "next/dynamic";
import { useProfile, useSession } from "@/features/account/queries";

/** Only a brand-new account ever sees the wizard, so it is not in the app bundle. */
const OnboardingFlow = dynamic(
  () => import("./onboarding-flow").then((module) => module.OnboardingFlow),
  {
    ssr: false,
    // Covers the app the same way the wizard will, so nothing flashes behind it.
    loading: () => <div aria-hidden className="fixed inset-0 z-60 bg-canvas/90 backdrop-blur-md" />,
  },
);

/**
 * Mounted once for the whole app. Shows the first-login wizard until the
 * profile carries `onboarding_completed_at`; a worker account never gets one,
 * it has its own environment. Finishing the wizard updates the same cached
 * profile the rest of the app reads, so this unmounts itself right away.
 */
export function OnboardingGate() {
  const { worker } = useSession();
  const profile = useProfile();
  if (worker || profile.onboarding_completed_at) return null;
  return <OnboardingFlow />;
}
