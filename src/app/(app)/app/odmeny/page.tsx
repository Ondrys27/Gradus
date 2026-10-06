import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkerRewardsView } from "@/features/workers/worker-env/worker-rewards-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("myRewards") };
}

export default function MyRewardsPage() {
  return <WorkerRewardsView />;
}
