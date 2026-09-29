/** The five steps shown as dots, in order. */
export const ONBOARDING_STEPS = ["welcome", "industry", "region", "milestone", "contact"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
