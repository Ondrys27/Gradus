import { redirect } from "next/navigation";
import { PLAN_PATH } from "@/lib/routes";

/** The plan page moved into Settings → Subscription; old links land there. */
export default function TarifPage() {
  redirect(PLAN_PATH);
}
