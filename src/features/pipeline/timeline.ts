import type { Json } from "@/types/database";
import { instantToZonedParts, zonedWallClockToInstant, type IsoDate } from "@/lib/format";
import type { CrmTask } from "@/features/crm-tasks/types";
import { contactLabel } from "./board-logic";
import type {
  Deal,
  DealActivity,
  DealContactLink,
  DealEventRow,
  DealInvoice,
  DealMeeting,
} from "./types";

/**
 * The history of a deal, newest first, put together from what already exists:
 * the deal itself (made, won, lost), the database's log of stage, value and
 * Close Date changes, its contacts, its tasks, its meetings, the e-mails sent
 * from it and its invoices. Nothing is copied to build it.
 */

type Base = { key: string; at: number };

export type InvoiceStep = "issued" | "sent" | "paid" | "cancelled";

export type TimelineEntry = Base &
  (
    | { kind: "created"; actorId: string | null }
    | { kind: "stage"; from: string | null; to: string | null; actorId: string | null }
    | { kind: "won"; actorId: string | null }
    | { kind: "lost"; reason: string | null; actorId: string | null }
    | {
        kind: "value";
        from: number | null;
        to: number | null;
        fromCurrency: string;
        toCurrency: string;
        actorId: string | null;
      }
    | { kind: "closeDate"; from: IsoDate | null; to: IsoDate | null; actorId: string | null }
    | { kind: "contactAdded"; name: string | null; note: string | null; actorId: string | null }
    | { kind: "taskCreated"; task: CrmTask }
    | { kind: "taskDone"; task: CrmTask }
    /** `day` for an all-day appointment, shown without a time. */
    | { kind: "meeting"; meeting: DealMeeting; day: IsoDate | null }
    | { kind: "activity"; activity: DealActivity }
    /** `day` for steps the invoice keeps as a date (issued, paid). */
    | { kind: "invoice"; invoice: DealInvoice; step: InvoiceStep; day: IsoDate | null }
  );

export type TimelineKind = TimelineEntry["kind"];

export type TimelineInput = {
  deal: Pick<
    Deal,
    "id" | "created_at" | "created_by" | "won_at" | "lost_at" | "lost_reason" | "currency"
  >;
  events: DealEventRow[];
  contacts: DealContactLink[];
  tasks: CrmTask[];
  meetings: DealMeeting[];
  activities: DealActivity[];
  invoices: DealInvoice[];
  timeZone: string;
};

function record(payload: Json): Record<string, Json | undefined> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}
function str(value: Json | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
function num(value: Json | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** The newest first; at the same moment the deal's making stays last (it came first). */
const SAME_MOMENT_ORDER: Partial<Record<TimelineKind, number>> = { created: 0, contactAdded: 1 };

export function buildDealTimeline(input: TimelineInput): TimelineEntry[] {
  const { deal } = input;
  const madeAt = Date.parse(deal.created_at);
  const out: TimelineEntry[] = [
    { key: "created", at: madeAt, kind: "created", actorId: deal.created_by },
  ];

  let loggedWin = false;
  let loggedLoss = false;
  for (const event of input.events) {
    const at = Date.parse(event.occurred_at);
    const payload = record(event.payload);
    const base = { key: `event:${event.id}`, at, actorId: event.actor_id };
    if (event.kind === "stage") {
      if (payload.won === true) {
        loggedWin = true;
        out.push({ ...base, kind: "won" });
      } else if (payload.lost === true) {
        loggedLoss = true;
        out.push({ ...base, kind: "lost", reason: str(payload.reason) });
      } else {
        out.push({
          ...base,
          kind: "stage",
          from: str(payload.from_name),
          to: str(payload.to_name),
        });
      }
    } else if (event.kind === "value") {
      out.push({
        ...base,
        kind: "value",
        from: num(payload.from),
        to: num(payload.to),
        fromCurrency: str(payload.from_currency) ?? deal.currency,
        toCurrency: str(payload.to_currency) ?? deal.currency,
      });
    } else if (event.kind === "close_date") {
      out.push({ ...base, kind: "closeDate", from: str(payload.from), to: str(payload.to) });
    }
  }

  // A deal won or lost before the log existed, or made straight into the stage.
  if (deal.won_at && !loggedWin) {
    out.push({ key: "won", at: Date.parse(deal.won_at), kind: "won", actorId: null });
  }
  if (deal.lost_at && !loggedLoss) {
    out.push({
      key: "lost",
      at: Date.parse(deal.lost_at),
      kind: "lost",
      reason: deal.lost_reason,
      actorId: null,
    });
  }

  for (const link of input.contacts) {
    const at = Date.parse(link.created_at);
    // The contact the deal was made with is part of making it.
    if (at <= madeAt) continue;
    out.push({
      key: `contact:${link.id}`,
      at,
      kind: "contactAdded",
      name: link.contact ? contactLabel(link.contact) : null,
      note: link.note,
      actorId: link.created_by,
    });
  }

  for (const task of input.tasks) {
    out.push({
      key: `task:${task.id}`,
      at: Date.parse(task.created_at),
      kind: "taskCreated",
      task,
    });
    if (task.status === "done" && task.completed_at) {
      out.push({
        key: `task-done:${task.id}`,
        at: Date.parse(task.completed_at),
        kind: "taskDone",
        task,
      });
    }
  }

  for (const meeting of input.meetings) {
    const at = Date.parse(meeting.starts_at);
    out.push({
      key: `meeting:${meeting.id}`,
      at,
      kind: "meeting",
      meeting,
      day:
        meeting.all_day && Number.isFinite(at)
          ? instantToZonedParts(new Date(at), input.timeZone).date
          : null,
    });
  }

  for (const activity of input.activities) {
    out.push({
      key: `activity:${activity.id}`,
      at: Date.parse(activity.occurred_at),
      kind: "activity",
      activity,
    });
  }

  const dayStart = (day: IsoDate) =>
    zonedWallClockToInstant(day, "00:00", input.timeZone).getTime();
  for (const invoice of input.invoices) {
    // A credit note belongs to the cancelled invoice; a draft has not happened yet.
    if (invoice.kind === "credit_note") continue;
    const steps: [InvoiceStep, number | null, IsoDate | null][] = [
      ["issued", invoice.issued_on ? dayStart(invoice.issued_on) : null, invoice.issued_on],
      ["sent", invoice.sent_at ? Date.parse(invoice.sent_at) : null, null],
      ["paid", invoice.paid_on ? dayStart(invoice.paid_on) : null, invoice.paid_on],
      ["cancelled", invoice.cancelled_at ? Date.parse(invoice.cancelled_at) : null, null],
    ];
    for (const [step, at, day] of steps) {
      if (at === null) continue;
      out.push({ key: `invoice:${invoice.id}:${step}`, at, kind: "invoice", invoice, step, day });
    }
  }

  return out
    .filter((entry) => Number.isFinite(entry.at))
    .sort(
      (a, b) =>
        b.at - a.at ||
        (SAME_MOMENT_ORDER[b.kind] ?? 2) - (SAME_MOMENT_ORDER[a.kind] ?? 2) ||
        a.key.localeCompare(b.key),
    );
}
