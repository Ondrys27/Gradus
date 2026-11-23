"use client";

import { DashboardHome } from "@/features/dashboard/dashboard-home";

/**
 * The dashboard of widgets (28.5) for everyone: an owner starts on the
 * system's default, a worker on the one their company set (or the system's
 * for a worker); what a worker may not see is never on it.
 */
export function HomeDashboard() {
  return <DashboardHome />;
}
