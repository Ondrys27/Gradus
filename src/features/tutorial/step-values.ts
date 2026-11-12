"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProfile } from "@/features/account/queries";
import { industryKeyOf } from "@/features/onboarding/industries";

/**
 * What Grady fills into the steps so they talk about the user's own
 * business: the branch picked in onboarding and its first milestone and
 * task (the onboarding suggestions), the first sample contact and the
 * sample deal (the rows the full tutorial seeded). Every step text may use
 * any of them; unused ones are simply left out.
 */
export type StepValues = {
  branch: string;
  milestone: string;
  task: string;
  contact: string;
  deal: string;
};

export function useStepValues(): StepValues {
  const profile = useProfile();
  const industry = industryKeyOf(profile.industry);
  const industries = useTranslations("onboarding.industry.industries");
  const demo = useTranslations("tutorial.demo");
  return useMemo(() => {
    const contact = demo(`contacts.first.company.${industry}`);
    return {
      branch: demo(`branch.${industry}`),
      milestone: industries(`${industry}.milestoneTitle`),
      task: industries(`${industry}.task1`),
      contact,
      deal: demo(`deal.${industry}`, { company: contact }),
    };
  }, [industry, industries, demo]);
}
