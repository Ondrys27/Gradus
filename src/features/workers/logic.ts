import { z } from "zod";
import type { Tone } from "@/components/ui/tone";
import { PERMISSION_SECTIONS, type PermissionSection } from "@/components/layout/nav-items";
import { parseAmount } from "@/features/pipeline/schemas";
import type { IsoDate } from "@/lib/format";
import { localizedPath } from "@/lib/routes";
import type { EarningStatus, WorkerInvite, WorkerPermission } from "./types";

export const NAME_MAX = 80;
export const JOB_TITLE_MAX = 60;
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 2000;
export const NOTE_MAX = 200;
export const PAYMENT_MAX = 100_000_000;
export const PAGE_SIZE = 20;

/** Translation keys under `workers.errors`. */
export type WorkerErrorKey =
  | "nameRequired"
  | "nameTooLong"
  | "emailInvalid"
  | "jobTitleTooLong"
  | "titleRequired"
  | "titleTooLong"
  | "descriptionTooLong"
  | "amountInvalid"
  | "noteTooLong"
  | "dateRequired";

// ---------------------------------------------------------------------------
// Months and invites
// ---------------------------------------------------------------------------

/** First day of the month of a calendar day in the user's zone. */
export function monthStartOf(today: IsoDate): IsoDate {
  return `${today.slice(0, 7)}-01`;
}

/**
 * The link the owner sends, to the registration page in the owner's language;
 * the code alone also works there.
 */
export function inviteUrl(code: string, origin: string, locale?: string): string {
  const register = localizedPath("register", locale);
  return `${origin.replace(/\/+$/, "")}${register}?invite=${encodeURIComponent(code)}`;
}

export type InviteState = "open" | "expired" | "accepted";

export function inviteState(
  invite: Pick<WorkerInvite, "expires_at" | "accepted_at">,
  now: Date,
): InviteState {
  if (invite.accepted_at) return "accepted";
  return Date.parse(invite.expires_at) <= now.getTime() ? "expired" : "open";
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type AccessLevel = "none" | "view" | "edit";
export type PermissionDraft = Record<PermissionSection, AccessLevel>;

export function emptyPermissions(): PermissionDraft {
  return Object.fromEntries(
    PERMISSION_SECTIONS.map(({ section }) => [section, "none"]),
  ) as PermissionDraft;
}

export function permissionsFromRows(rows: WorkerPermission[]): PermissionDraft {
  const draft = emptyPermissions();
  for (const row of rows) {
    if (!(row.section in draft)) continue;
    draft[row.section as PermissionSection] = row.can_edit
      ? "edit"
      : row.can_view
        ? "view"
        : "none";
  }
  return draft;
}

/** Ready-made roles that fill the matrix; any change after that makes it "custom". */
export const PERMISSION_PRESETS = ["caller", "sales", "assistant"] as const;
export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];

const PRESET_ACCESS: Record<PermissionPreset, Partial<PermissionDraft>> = {
  // Calls the leads: contacts and cold calling, both to work with.
  caller: { contacts: "edit", cold_calling: "edit" },
  // Also carries deals through the pipeline and books meetings.
  sales: { contacts: "edit", cold_calling: "edit", pipeline: "edit", calendar: "edit" },
  // Keeps milestones and the calendar, looks contacts up.
  assistant: { milestones: "edit", calendar: "edit", contacts: "view" },
};

/** The matrix of a role. Finance stays closed in every one of them. */
export function presetPermissions(preset: PermissionPreset): PermissionDraft {
  return { ...emptyPermissions(), ...PRESET_ACCESS[preset] };
}

/** Which role the matrix matches exactly, or "custom". */
export function presetOf(draft: PermissionDraft): PermissionPreset | "custom" {
  const sections = PERMISSION_SECTIONS.map(({ section }) => section);
  return (
    PERMISSION_PRESETS.find((preset) => {
      const expected = presetPermissions(preset);
      return sections.every((section) => expected[section] === draft[section]);
    }) ?? "custom"
  );
}

/**
 * One switch of the matrix. Editing includes seeing: turning edit on turns
 * view on, turning view off turns edit off.
 */
export function toggleAccess(
  draft: PermissionDraft,
  section: PermissionSection,
  column: "view" | "edit",
  on: boolean,
): PermissionDraft {
  const current = draft[section];
  let next: AccessLevel;
  if (column === "view") next = on ? (current === "none" ? "view" : current) : "none";
  else next = on ? "edit" : current === "none" ? "none" : "view";
  return { ...draft, [section]: next };
}

/** One row per section, so a section taken away is stored as closed, not left behind. */
export function permissionRows(draft: PermissionDraft): WorkerPermission[] {
  return PERMISSION_SECTIONS.map(({ section }) => ({
    section,
    can_view: draft[section] !== "none",
    can_edit: draft[section] === "edit",
  }));
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const workerSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(NAME_MAX, "nameTooLong"),
  email: z.string().trim().toLowerCase().email("emailInvalid").max(254, "emailInvalid"),
  job_title: z
    .string()
    .trim()
    .max(JOB_TITLE_MAX, "jobTitleTooLong")
    .transform((value) => value || null),
});
export type WorkerInput = z.infer<typeof workerSchema>;

export const workerTaskSchema = z.object({
  title: z.string().trim().min(1, "titleRequired").max(TASK_TITLE_MAX, "titleTooLong"),
  description: z
    .string()
    .trim()
    .max(TASK_DESCRIPTION_MAX, "descriptionTooLong")
    .transform((value) => value || null),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type WorkerTaskInput = z.infer<typeof workerTaskSchema>;

export const paymentSchema = z.object({
  amount: z
    .number()
    .refine(Number.isFinite, "amountInvalid")
    .positive("amountInvalid")
    .max(PAYMENT_MAX, "amountInvalid"),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateRequired"),
  note: z.string().trim().max(NOTE_MAX, "noteTooLong"),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export type Validated<T> =
  { ok: true; data: T } | { ok: false; errors: Partial<Record<string, WorkerErrorKey>> };

export function validate<T extends z.ZodType>(schema: T, input: unknown): Validated<z.infer<T>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Partial<Record<string, WorkerErrorKey>> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message as WorkerErrorKey;
  }
  return { ok: false, errors };
}

/** The amount typed in a payment field; NaN for anything that is not an amount. */
export function amountFromInput(text: string): number {
  return parseAmount(text) ?? Number.NaN;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const EARNING_TONE: Record<EarningStatus, Tone> = {
  pending: "gold",
  approved: "teal",
  paid: "green",
};

/** Share of the month's tasks that are done, 0–1. */
export function taskProgress(done: number, total: number): number {
  return total > 0 ? Math.min(done / total, 1) : 0;
}
