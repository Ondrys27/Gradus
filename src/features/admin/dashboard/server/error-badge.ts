import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminQuery } from "../../server/metrics-data";
import { loadErrorGroups } from "../../server/error-log-data";
import { ERROR_BADGE_DAYS, type ErrorBadge } from "../error-badge";

/** The New errors of the last days and the newest five of them (the bell). */
export async function loadErrorBadge(): Promise<ErrorBadge> {
  const q = adminQuery({ period: `${ERROR_BADGE_DAYS}d` }, "errors");
  const [count, latest] = await Promise.all([
    createAdminClient().rpc("admin_error_badge", { _days: ERROR_BADGE_DAYS }),
    loadErrorGroups(q, { status: "new", code: null, latest: false, page: 0 }),
  ]);
  if (count.error) throw new Error(`admin_error_badge: ${count.error.message}`);
  return {
    count: count.data ?? 0,
    latest: [...latest.rows]
      .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
      .slice(0, 5)
      .map((row) => ({
        fingerprint: row.fingerprint,
        code: row.lastCode,
        message: row.message,
        page: row.page,
        lastAt: row.lastAt,
        returned: row.returnedAt !== null,
      })),
  };
}
