import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RewardEditor } from "@/features/workers/rewards/reward-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workers.rewards");
  return { title: t("title") };
}

export default function RewardsSetupPage() {
  return <RewardEditor />;
}
