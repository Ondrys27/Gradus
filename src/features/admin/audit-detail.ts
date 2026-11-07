/**
 * The before/after of an audited change (admin_audit.detail) as one line:
 * "monthly_usd: 90 → 120 · warn_percent: 80 → 75". Only the fields that
 * changed; identifiers and numbers. A user the change was about leads, named
 * by `nameOf` (see display-name.ts); the reason a support action was given
 * (step 22.1, written by the administrator) closes the line.
 */

type Values = Record<string, unknown> | null;

function asValues(value: unknown): Values {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function show(value: unknown, empty: string): string {
  if (value === null || value === undefined) return empty;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.slice(0, 40);
  return JSON.stringify(value).slice(0, 40);
}

/** The id of the user an audited change was about, if any. */
export function auditDetailUser(detail: unknown): string | null {
  const root = asValues(detail);
  return root && typeof root.user === "string" ? root.user : null;
}

export function describeAuditDetail(
  detail: unknown,
  empty: string,
  nameOf: (id: string) => string,
): string {
  const root = asValues(detail);
  if (!root) return "";
  const from = asValues(root.from);
  const to = asValues(root.to);
  const keys = [...new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])].sort();
  const changes = keys
    .filter((key) => JSON.stringify(from?.[key] ?? null) !== JSON.stringify(to?.[key] ?? null))
    .map((key) => `${key}: ${show(from?.[key], empty)} → ${show(to?.[key], empty)}`);
  const isChange = "from" in root || "to" in root;
  if (isChange && !changes.length && from === null && to === null) {
    changes.push(`${empty} → ${empty}`);
  }
  const userId = auditDetailUser(root);
  const user = userId ? nameOf(userId) : null;
  const reason =
    typeof root.reason === "string" && root.reason.trim()
      ? root.reason.trim().replace(/\s+/g, " ").slice(0, 120)
      : null;
  return [user, ...changes, reason].filter(Boolean).join(" · ");
}
