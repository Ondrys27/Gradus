import { redirect } from "next/navigation";
import { COMPANY_PATH } from "@/lib/routes";

/**
 * The drawn reward system gave way to a plan per worker (28.2): their
 * dashboard → Rewards, and everyone at once in Company → Rewards and payouts.
 */
export default function RewardsSetupPage() {
  redirect(`${COMPANY_PATH}?tab=rewards`);
}
