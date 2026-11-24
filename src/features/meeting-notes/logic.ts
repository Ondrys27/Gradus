import { z } from "zod";

/**
 * Meeting notes in one go (28.7): a transcript or notes of a meeting become a
 * list of proposed changes the user ticks, edits and confirms at once. Pure:
 * the limits, cutting a long transcript into parts, the shape the model
 * answers in, matching its names to people and stages, and the confirmed
 * changes as calls of Grady's tools (run as one action with one Undo).
 */

/** The longest text taken in (a three-hour transcript with speakers fits). */
export const MEETING_TEXT_MAX = 400_000;
/** Shorter than this is no meeting (a word or two). */
export const MEETING_TEXT_MIN = 40;
/** One part of a long transcript: about 12 000 tokens. */
export const CHUNK_CHARS = 48_000;
/** A long transcript in more parts than this is cut (and the model is told so). */
export const MAX_CHUNKS = 9;
/** Files read: plain text, Word, PDF. */
export const MEETING_FILE_EXTENSIONS = [".txt", ".docx", ".pdf"] as const;
export const MEETING_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const MAX_TASKS = 12;
export const MAX_CONTACTS = 6;
export const SUMMARY_MAX = 5000;
export const NOTE_TEXT_MAX = 20_000;
export const TASK_TITLE_MAX = 200;

export const MEETING_TARGETS = ["deal", "contact", "event"] as const;
export type MeetingTarget = { kind: (typeof MEETING_TARGETS)[number]; id: string };

// ---------------------------------------------------------------------------
// A long transcript in parts
// ---------------------------------------------------------------------------

/**
 * Cuts the text into parts of at most `size` characters, at a speaker's turn
 * or a paragraph where it can (never inside a line when a line break is
 * near), so no sentence of one speaker is split across parts.
 */
export function chunkTranscript(text: string, size = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const parts: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      // A blank line, else a line break, in the last third of the part.
      const floor = Math.floor(size * 0.66);
      const paragraph = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      if (paragraph > floor) end = start + paragraph;
      else if (line > floor) end = start + line;
      else {
        const space = window.lastIndexOf(" ");
        if (space > floor) end = start + space;
      }
    }
    const part = clean.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// What the model answers
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .optional();

const modelTask = z.object({
  title: line(TASK_TITLE_MAX).min(1),
  due: day,
  time,
  assignee: line(120).nullable().optional(),
  minutes: z.number().int().min(5).max(480).nullable().optional(),
});

export const meetingAnswerSchema = z.object({
  summary: line(SUMMARY_MAX).nullable().optional(),
  next_step: modelTask.nullable().optional(),
  tasks: z.array(modelTask).max(30).optional(),
  stage: line(120).nullable().optional(),
  close_date: day,
  amount: z.number().min(0).max(1e12).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullable()
    .optional(),
  contacts: z
    .array(
      z.object({
        first_name: line(120).nullable().optional(),
        last_name: line(120).nullable().optional(),
        company: line(120).nullable().optional(),
        email: line(254).nullable().optional(),
        phone: line(40).nullable().optional(),
        role: line(200).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  note: z
    .object({ title: line(200).min(1), text: line(NOTE_TEXT_MAX) })
    .nullable()
    .optional(),
});
export type MeetingAnswer = z.infer<typeof meetingAnswerSchema>;

/** One part of a long transcript, condensed before the proposal is written from all parts. */
export const digestSchema = z.object({
  points: z.array(line(400)).max(40).optional(),
  decisions: z.array(line(400)).max(20).optional(),
  action_items: z
    .array(
      z.object({
        what: line(300),
        who: line(120).nullable().optional(),
        when: line(120).nullable().optional(),
      }),
    )
    .max(30)
    .optional(),
  numbers: z.array(line(200)).max(20).optional(),
  people: z
    .array(
      z.object({
        name: line(160),
        company: line(120).nullable().optional(),
        role: line(200).nullable().optional(),
        email: line(254).nullable().optional(),
        phone: line(40).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type Digest = z.infer<typeof digestSchema>;

/** The digests of all parts as one text the final call reads instead of the transcript. */
export function digestsText(digests: Digest[]): string {
  return digests
    .map((digest, index) => {
      const out = [`## Part ${index + 1}`];
      const list = (title: string, items: string[] | undefined) => {
        if (items?.length) out.push(`${title}:`, ...items.map((item) => `- ${item}`));
      };
      list("Points", digest.points);
      list("Decisions", digest.decisions);
      list(
        "Action items",
        digest.action_items?.map(
          (item) =>
            `${item.what}${item.who ? ` (who: ${item.who})` : ""}${item.when ? ` (when: ${item.when})` : ""}`,
        ),
      );
      list("Numbers", digest.numbers);
      list(
        "People",
        digest.people?.map((person) =>
          [person.name, person.company, person.role, person.email, person.phone]
            .filter(Boolean)
            .join(", "),
        ),
      );
      return out.join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// The proposal the user sees
// ---------------------------------------------------------------------------

export type Person = { id: string; name: string };
export type StageOption = { id: string; name: string; isWon: boolean; isLost: boolean };

export type ProposedTask = {
  key: string;
  title: string;
  /** ISO instant; null = tomorrow 9:00 (the task dialog's default). */
  dueAt: string | null;
  assigneeId: string | null;
  durationMinutes: number;
  nextStep: boolean;
};

export type ProposedContact = {
  key: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  role: string;
};

/** What may be proposed: each part only when the user may make that change. */
export type ProposalRights = {
  history: boolean;
  tasks: boolean;
  assignOthers: boolean;
  stage: boolean;
  dealFields: boolean;
  amount: boolean;
  contacts: boolean;
  linkContacts: boolean;
  note: boolean;
  linkNote: boolean;
  attachment: boolean;
};

export type MeetingProposal = {
  target: MeetingTarget;
  /** Where the changes go. */
  deal: {
    id: string;
    title: string;
    stageId: string;
    closeDate: string | null;
    value: number | null;
    currency: string;
  } | null;
  contact: { id: string; name: string } | null;
  summary: string | null;
  tasks: ProposedTask[];
  stageId: string | null;
  closeDate: string | null;
  amount: { value: number; currency: string } | null;
  contacts: ProposedContact[];
  note: { title: string; text: string } | null;
  people: Person[];
  stages: StageOption[];
  rights: ProposalRights;
  /** How many parts a long transcript was read in, and whether its end was cut. */
  parts: number;
  truncated: boolean;
};

/** Lower case without diacritics, for matching a name the model wrote. */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The person the model named: the full name, else a unique first name or
 * surname. "me", "I", "já" or nothing = nobody in particular (the default).
 */
export function matchPerson(
  name: string | null | undefined,
  people: readonly Person[],
): string | null {
  if (!name) return null;
  const wanted = plain(name);
  if (!wanted) return null;
  const exact = people.filter((person) => plain(person.name) === wanted);
  if (exact.length === 1) return exact[0].id;
  const words = wanted.split(" ");
  const partial = people.filter((person) => {
    const parts = plain(person.name).split(" ");
    return words.every((word) => parts.includes(word));
  });
  return partial.length === 1 ? partial[0].id : null;
}

/** The stage the model named, by its name (exact, else the only one containing it). */
export function matchStage(
  name: string | null | undefined,
  stages: readonly StageOption[],
): string | null {
  if (!name) return null;
  const wanted = plain(name);
  if (!wanted) return null;
  const exact = stages.find((stage) => plain(stage.name) === wanted);
  if (exact) return exact.id;
  const partial = stages.filter(
    (stage) => plain(stage.name).includes(wanted) || wanted.includes(plain(stage.name)),
  );
  return partial.length === 1 ? partial[0].id : null;
}

/** A contact the model found that is not already one of the deal's or the contact itself. */
export function isNewContact(
  candidate: Pick<ProposedContact, "firstName" | "lastName" | "companyName" | "email">,
  existing: readonly { name: string; email: string | null }[],
): boolean {
  const email = candidate.email.trim().toLowerCase();
  const name = plain([candidate.firstName, candidate.lastName].filter(Boolean).join(" "));
  return !existing.some(
    (row) =>
      (email && row.email?.trim().toLowerCase() === email) ||
      (name && plain(row.name) === name) ||
      (!name && candidate.companyName && plain(row.name) === plain(candidate.companyName)),
  );
}

// ---------------------------------------------------------------------------
// The confirmed changes as tool calls
// ---------------------------------------------------------------------------

/** What the user confirmed (each part optional = not ticked). */
export const meetingApplySchema = z.object({
  target: z.object({ kind: z.enum(MEETING_TARGETS), id: z.uuid() }),
  dealId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  summary: z.string().trim().min(1).max(SUMMARY_MAX).nullable(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(TASK_TITLE_MAX),
        dueAt: z.iso.datetime({ offset: true }).nullable(),
        assigneeId: z.uuid().nullable(),
        durationMinutes: z.number().int().min(1).max(1440),
      }),
    )
    .max(MAX_TASKS),
  stageId: z.uuid().nullable(),
  closeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  amount: z
    .object({ value: z.number().min(0).max(1e12), currency: z.string().regex(/^[A-Z]{3}$/) })
    .nullable(),
  contacts: z
    .array(
      z.object({
        firstName: z.string().trim().max(120),
        lastName: z.string().trim().max(120),
        companyName: z.string().trim().max(120),
        email: z.string().trim().max(254),
        phone: z.string().trim().max(40),
        role: z.string().trim().max(200),
      }),
    )
    .max(MAX_CONTACTS),
  note: z
    .object({ title: z.string().trim().min(1).max(200), text: z.string().max(NOTE_TEXT_MAX) })
    .nullable(),
  transcript: z
    .object({
      name: z.string().trim().min(1).max(200),
      text: z.string().min(1).max(MEETING_TEXT_MAX),
    })
    .nullable(),
});
export type MeetingApply = z.infer<typeof meetingApplySchema>;

/** A call of a tool; "$<n>.<field>" in a value is the output of the n-th call before it. */
export type BundleCall = { name: string; input: Record<string, unknown> };

/**
 * The confirmed changes, in the order they are made: the history entry, the
 * deal's fields and stage, new contacts (and onto the deal), tasks, the note,
 * the transcript. `linkNote` = the note may be tied to the deal (own space).
 */
export function applyCalls(apply: MeetingApply, options: { linkNote: boolean }): BundleCall[] {
  const calls: BundleCall[] = [];
  const { dealId, contactId } = apply;
  if (apply.summary) {
    calls.push(
      dealId
        ? {
            name: "add_deal_history_entry",
            input: { dealId, type: "meeting", content: apply.summary },
          }
        : {
            name: "add_contact_activity",
            input: { contactId, type: "meeting", content: apply.summary },
          },
    );
  }
  if (dealId && (apply.closeDate || apply.amount)) {
    calls.push({
      name: "update_deal",
      input: {
        dealId,
        ...(apply.closeDate ? { closeDate: apply.closeDate } : {}),
        ...(apply.amount ? { value: apply.amount.value, currency: apply.amount.currency } : {}),
      },
    });
  }
  if (dealId && apply.stageId) {
    calls.push({ name: "move_deal_stage", input: { dealId, stageId: apply.stageId } });
  }
  for (const contact of apply.contacts) {
    const fields = {
      ...(contact.firstName ? { firstName: contact.firstName } : {}),
      ...(contact.lastName ? { lastName: contact.lastName } : {}),
      ...(contact.companyName ? { companyName: contact.companyName } : {}),
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
    };
    if (!fields.firstName && !fields.lastName && !fields.companyName) continue;
    calls.push({ name: "create_contact", input: fields });
    if (dealId) {
      calls.push({
        name: "add_deal_contact",
        input: {
          dealId,
          contactId: `$${calls.length - 1}.contactId`,
          ...(contact.role ? { note: contact.role.slice(0, 200) } : {}),
        },
      });
    }
  }
  for (const task of apply.tasks) {
    calls.push({
      name: "create_crm_task",
      input: {
        title: task.title,
        ...(dealId ? { dealId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(task.dueAt ? { dueAt: task.dueAt } : {}),
        durationMinutes: task.durationMinutes,
        ...(task.assigneeId ? { assigneeId: task.assigneeId } : {}),
      },
    });
  }
  if (apply.note) {
    calls.push({
      name: "create_note",
      input: {
        title: apply.note.title,
        text: apply.note.text,
        ...(dealId && options.linkNote ? { linkTo: { kind: "deal", id: dealId } } : {}),
      },
    });
  }
  if (dealId && apply.transcript) {
    calls.push({
      name: "save_deal_attachment",
      input: { dealId, name: apply.transcript.name, content: apply.transcript.text },
    });
  }
  return calls;
}

/** Puts the outputs of earlier calls into "$<n>.<field>" values (only ids, only earlier calls). */
export function resolveRefs(
  input: Record<string, unknown>,
  outputs: readonly unknown[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const match = typeof value === "string" ? /^\$(\d+)\.([a-zA-Z]+)$/.exec(value) : null;
    if (!match) {
      out[key] = value;
      continue;
    }
    const source = outputs[Number(match[1])];
    const found =
      source && typeof source === "object"
        ? (source as Record<string, unknown>)[match[2]]
        : undefined;
    out[key] = typeof found === "string" ? found : null;
  }
  return out;
}

/** How many changes the confirmed proposal makes (for the card and analytics). */
export function changeCount(apply: MeetingApply): number {
  return (
    (apply.summary ? 1 : 0) +
    (apply.closeDate || apply.amount ? 1 : 0) +
    (apply.stageId ? 1 : 0) +
    apply.contacts.length +
    apply.tasks.length +
    (apply.note ? 1 : 0) +
    (apply.transcript ? 1 : 0)
  );
}

/** POST /api/grady { kind: "meetingNotes" }: the meeting to read and what it belongs to. */
export const meetingAnalyzeSchema = z.object({
  kind: z.literal("meetingNotes"),
  target: z.object({ kind: z.enum(MEETING_TARGETS), id: z.uuid() }),
  text: z.string().min(MEETING_TEXT_MIN).max(MEETING_TEXT_MAX),
});

/** POST /api/grady { kind: "meetingNotesApply", apply }: the confirmed changes. */
export const meetingApplyRequestSchema = z.object({
  kind: z.literal("meetingNotesApply"),
  apply: meetingApplySchema,
});

export type MeetingNotesResponse =
  { ok: true; proposal: MeetingProposal } | { ok: false; code: string };
