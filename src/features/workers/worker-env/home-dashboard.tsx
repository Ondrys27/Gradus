"use client";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { useSession } from "@/features/account/queries";
import { WorkerDashboard } from "./worker-dashboard";

/** An owner gets the business dashboard, a worker their own. */
export function HomeDashboard() {
  const { worker } = useSession();
  return worker ? <WorkerDashboard /> : <DashboardView />;
}
