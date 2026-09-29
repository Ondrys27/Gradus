"use client";

import { useProfile, useSession } from "@/features/account/queries";
import { OnboardingFlow } from "./onboarding-flow";

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
