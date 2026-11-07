import { toCsv } from "./access";
import { metricCsvValue } from "./format-metric";

/**
 * The list of accounts as CSV (support, step 22.1): the id, the name and the
 * sign-in e-mail next to the figures of the list. It names people, so only
 * the owner exports it (PERSONAL_DATA_EXPORTS); the route writes the audit
 * row before the file leaves.
 */

export const USERS_EXPORT_HEADER = [
  "user_id",
  "name",
  "email",
  "plan",
  "status",
  "role",
  "internal",
  "signed_up_at",
  "last_active_at",
  "ai_cost_usd",
] as const;

export type UsersExportRow = {
  userId: string;
  plan: string;
  status: string;
  role: string | null;
  isInternal: boolean;
  signedUpAt: string;
  lastActiveAt: string | null;
  aiCostUsd: number;
};

export function usersCsv(
  rows: readonly UsersExportRow[],
  nameOf: (id: string) => string,
  emailOf: (id: string) => string | null,
): string {
  return toCsv(
    USERS_EXPORT_HEADER,
    rows.map((row) => [
      row.userId,
      nameOf(row.userId),
      emailOf(row.userId),
      row.plan,
      row.status,
      row.role,
      row.isInternal ? "true" : "false",
      row.signedUpAt,
      row.lastActiveAt,
      metricCsvValue(row.aiCostUsd, "usd"),
    ]),
  );
}
