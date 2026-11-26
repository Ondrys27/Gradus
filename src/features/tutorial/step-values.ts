"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProfile, useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { industryKeyOf } from "@/features/onboarding/industries";
import { templateOf } from "@/features/workers/permissions-catalog";

/**
 * What Grady fills into the steps so they talk about the user's own
 * business: the branch picked in onboarding and its first milestone and
 * task (the onboarding suggestions), the first sample contact and the
 * sample deal (the rows the full tutorial seeded); in a company (30.2) who
 * the person works for and their role there. Every step text may use any of
 * them; unused ones are simply left out.
 */
export type StepValues = {
  branch: string;
  milestone: string;
  task: string;
  contact: string;
  deal: string;
  company: string;
  role: string;
};

export function useStepValues(): StepValues {
  const profile = useProfile();
  const industry = industryKeyOf(profile.industry);
  const industries = useTranslations("onboarding.industry.industries");
  const demo = useTranslations("tutorial.demo");
  const tutorial = useTranslations("tutorial");
  const templates = useTranslations("workers.permissions.templates");
  const { worker, spaces, spaceId } = useSession();
  const workspace = useWorkspace();
  const space = spaces.find((entry) => entry.spaceId === spaceId);
  const company = space?.companyName ?? space?.ownerName ?? tutorial("companyFallback");
  const template = worker ? templateOf(workspace.grants) : null;
  const role = worker?.jobTitle?.trim() || (template ? templates(template) : tutorial("roleFallback"));
  return useMemo(() => {
    const contact = demo(`contacts.first.company.${industry}`);
    return {
      branch: demo(`branch.${industry}`),
      milestone: industries(`${industry}.milestoneTitle`),
      task: industries(`${industry}.task1`),
      contact,
      deal: demo(`deal.${industry}`, { company: contact }),
      company,
      role,
    };
  }, [industry, industries, demo, company, role]);
}
