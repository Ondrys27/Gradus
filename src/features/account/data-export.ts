import { DEFAULT_FORMAT_SETTINGS, todayIsoDate } from "@/lib/format";
import type { Database } from "@/types/database";

/**
 * "Export my data" (Settings → Account): which tables go into the ZIP, which
 * columns, and how a CSV is written. Only the account's own rows: the owner
 * column must equal the signed-in user (a worker exports their own account,
 * not the owner's workspace). Internal columns (search vectors, editor JSON,
 * stored PDF paths, flags of the app itself) stay out.
 */

type Tables = Database["public"]["Tables"];
type TableName = keyof Tables;
type ColumnOf<T extends TableName> = keyof Tables[T]["Row"] & string;

type TableSpec<T extends TableName> = {
  /** File name in the ZIP, without .csv. */
  file: string;
  table: T;
  /** The column that holds the account (user_id, or id for the profile). */
  owner: ColumnOf<T>;
  columns: readonly ColumnOf<T>[];
};

/** One table of the export, its columns checked against that table. */
export type ExportTable = { [T in TableName]: TableSpec<T> }[TableName];

function table<T extends TableName>(
  file: string,
  name: T,
  owner: ColumnOf<T>,
  columns: readonly ColumnOf<T>[],
): TableSpec<T> {
  return { file, table: name, owner, columns };
}

/** Tables with the tutorial's sample data: the export carries only the user's own rows. */
export const SAMPLE_FLAGGED_TABLES: ReadonlySet<TableName> = new Set<TableName>([
  "milestones",
  "tasks",
  "crm_tasks",
  "contacts",
  "deals",
  "calendar_events",
  "notes",
]);

export const EXPORT_TABLES = [
  table("profile", "profiles", "id", [
    "id",
    "display_name",
    "username",
    "industry",
    "mode",
    "path_key",
    "onboarding_completed_at",
    "created_at",
  ]),
  table("settings", "user_settings", "user_id", [
    "locale",
    "timezone",
    "country_code",
    "currency",
    "date_format",
    "time_format",
    "number_format",
    "first_day_of_week",
    "theme",
    "sound_enabled",
    "animations_enabled",
    "daily_call_goal",
    "reengage_after_months",
    "jarvis_proactive",
    "jarvis_frequency",
    "jarvis_quiet_from",
    "jarvis_quiet_to",
    "updated_at",
  ]),
  table("milestones", "milestones", "user_id", [
    "id",
    "title",
    "description",
    "category",
    "status",
    "tag",
    "reward",
    "target_date",
    "completed_at",
    "position",
    "created_at",
    "updated_at",
  ]),
  table("tasks", "tasks", "user_id", [
    "id",
    "milestone_id",
    "parent_task_id",
    "title",
    "description",
    "status",
    "due_date",
    "completed_at",
    "position",
    "created_at",
    "updated_at",
  ]),
  table("crm_tasks", "crm_tasks", "user_id", [
    "id",
    "title",
    "description",
    "due_at",
    "duration_minutes",
    "status",
    "deal_id",
    "contact_id",
    "completed_at",
    "completion_note",
    "created_at",
    "updated_at",
  ]),
  table("contacts", "contacts", "user_id", [
    "id",
    "first_name",
    "last_name",
    "company_name",
    "email",
    "phone",
    "website",
    "address",
    "city",
    "postal_code",
    "country_code",
    "company_reg_no",
    "vat_no",
    "tags",
    "notes",
    "source",
    "created_at",
    "updated_at",
  ]),
  table("contact_tables", "contact_tables", "user_id", [
    "id",
    "name",
    "system_key",
    "position",
    "created_at",
  ]),
  table("contact_table_entries", "contact_table_entries", "user_id", [
    "contact_id",
    "table_id",
    "answers",
    "moved_at",
  ]),
  table("contact_activities", "contact_activities", "user_id", [
    "id",
    "contact_id",
    "deal_id",
    "type",
    "content",
    "occurred_at",
    "created_at",
  ]),
  table("pipeline_stages", "pipeline_stages", "user_id", [
    "id",
    "name",
    "position",
    "is_won",
    "is_lost",
    "deposit_percent",
  ]),
  table("deals", "deals", "user_id", [
    "id",
    "title",
    "description",
    "stage_id",
    "contact_id",
    "value",
    "currency",
    "expected_close_date",
    "deadline_date",
    "entered_stage_at",
    "won_at",
    "lost_at",
    "lost_reason",
    "last_activity_at",
    "created_at",
    "updated_at",
  ]),
  table("deal_contacts", "deal_contacts", "user_id", [
    "deal_id",
    "contact_id",
    "is_primary",
    "note",
    "created_at",
  ]),
  table("calendar_events", "calendar_events", "user_id", [
    "id",
    "title",
    "description",
    "kind",
    "starts_at",
    "ends_at",
    "all_day",
    "location",
    "contact_id",
    "deal_id",
    "task_id",
    "source",
    "created_at",
  ]),
  table("transactions", "transactions", "user_id", [
    "id",
    "type",
    "amount",
    "currency",
    "category",
    "description",
    "occurred_on",
    "source",
    "deal_id",
    "invoice_id",
    "created_at",
  ]),
  table("recurring_payments", "recurring_payments", "user_id", [
    "id",
    "type",
    "amount",
    "currency",
    "category",
    "description",
    "frequency",
    "due_day",
    "next_due_on",
    "ends_on",
    "is_active",
    "created_at",
  ]),
  table("finance_plan_months", "finance_plan_months", "user_id", [
    "id",
    "month",
    "opening_capital",
    "reserve",
    "currency",
    "closed",
    "created_at",
  ]),
  table("finance_plan_rows", "finance_plan_rows", "user_id", [
    "id",
    "month",
    "kind",
    "label",
    "position",
    "source",
    "source_id",
    "created_at",
  ]),
  table("finance_plan_cells", "finance_plan_cells", "user_id", [
    "row_id",
    "week",
    "planned",
    "note",
    "updated_at",
  ]),
  table("invoices", "invoices", "user_id", [
    "id",
    "kind",
    "number",
    "status",
    "customer_name",
    "customer",
    "items",
    "subtotal",
    "vat_total",
    "total",
    "currency",
    "issued_on",
    "taxable_on",
    "due_on",
    "paid_on",
    "cancelled_at",
    "variable_symbol",
    "note",
    "deal_id",
    "contact_id",
    "created_at",
  ]),
  table("notes", "notes", "user_id", [
    "id",
    "title",
    "content_text",
    "pinned",
    "deleted_at",
    "created_at",
    "updated_at",
  ]),
  // The scheduler (24.3): the person's booking pages, meeting types, hours and bookings.
  table("scheduler_profiles", "scheduler_profiles", "user_id", [
    "id",
    "space_id",
    "handle",
    "display_name",
    "headline",
    "bio",
    "time_zone",
    "video_link",
    "created_at",
  ]),
  table("meeting_types", "event_types", "user_id", [
    "id",
    "profile_id",
    "slug",
    "name",
    "description",
    "duration_min",
    "location_kind",
    "location_text",
    "active",
    "requires_approval",
    "buffer_before_min",
    "buffer_after_min",
    "min_notice_hours",
    "max_days_ahead",
    "max_per_day",
    "slot_step_min",
    "questions",
    "reminders",
    "confirmation_note",
    "created_at",
  ]),
  table("availability_rules", "availability_rules", "user_id", [
    "profile_id",
    "event_type_id",
    "weekday",
    "start_time",
    "end_time",
  ]),
  table("availability_overrides", "availability_overrides", "user_id", [
    "profile_id",
    "date",
    "start_time",
    "end_time",
  ]),
  table("bookings", "bookings", "host_user_id", [
    "id",
    "event_type_id",
    "starts_at",
    "ends_at",
    "guest_name",
    "guest_email",
    "guest_phone",
    "guest_company",
    "guest_time_zone",
    "answers",
    "status",
    "cancelled_by",
    "cancel_reason",
    "created_at",
  ]),
  // Never the secret link; only where it points.
  table("calendar_subscriptions", "calendar_subscriptions", "user_id", [
    "name",
    "url_hint",
    "last_fetched_at",
    "last_status",
    "created_at",
  ]),
] as const satisfies readonly ExportTable[];

/**
 * Text that a spreadsheet would run as a formula gets a leading apostrophe
 * (CSV injection). A phone number or a negative amount stays as it is.
 */
const FORMULA = /^(?:[=@\t\r]|[+-](?![\d\s.,]))/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "string") text = FORMULA.test(value) ? `'${value}` : value;
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * A CSV file: UTF-8 with a byte order mark (Excel then reads the diacritics),
 * comma separated, CRLF line ends, header from the column names.
 */
export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]) {
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** gradus-data-2026-11-01.zip, by the day in the user's time zone. */
export function exportFileName(appName: string, now: Date, timeZone: string): string {
  const day = todayIsoDate({ ...DEFAULT_FORMAT_SETTINGS, timeZone }, now);
  return `${appName.toLowerCase()}-data-${day}.zip`;
}
