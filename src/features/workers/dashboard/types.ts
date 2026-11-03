import type { WorkerStatus } from "../types";

/** The tabs of a person's dashboard, in order; `?wtab=` in the address. */
export const DASHBOARD_TABS = [
  "overview",
  "rights",
  "work",
  "documents",
  "team",
  "rewards",
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export function isDashboardTab(value: string | null | undefined): value is DashboardTab {
  return (DASHBOARD_TABS as readonly string[]).includes(value ?? "");
}

/** Who is looking: the owner, the person themself, or another worker. */
export type DashboardViewer = "owner" | "self" | "other";

/** One person as the dashboard shows them (company_worker()). */
export type DashboardWorker = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  description: string | null;
  avatarUrl: string | null;
  status: WorkerStatus;
  /** Null = right under the owner (or above what the viewer may see). */
  managerId: string | null;
  /** The worker's account once the invite is accepted; deals and tasks hang on it. */
  userId: string | null;
  createdAt: string;
  /** The viewer may change the details, groups and documents. */
  canEdit: boolean;
  /** The viewer is this person. */
  isSelf: boolean;
};
