import { describe, expect, it } from "vitest";
import {
  bookingLabel,
  bookingProblem,
  canApprove,
  canCancel,
  canDecline,
  canMarkNoShow,
  canReschedule,
  guestCanManage,
  holdActive,
  holdSecondsLeft,
  surveyDue,
  type BookingLife,
} from "./state";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const booking = (status: string, start: number, end: number, extra: Partial<BookingLife> = {}) => ({
  status,
  starts_at: at(start),
  ends_at: at(end),
  ...extra,
});

describe("holds", () => {
  it("a hold keeps its time until it expires", () => {
    expect(holdActive({ status: "held", hold_expires_at: at(1) }, NOW)).toBe(true);
    expect(holdActive({ status: "held", hold_expires_at: at(0) }, NOW)).toBe(false);
    expect(holdActive({ status: "held", hold_expires_at: null }, NOW)).toBe(false);
    expect(holdActive({ status: "pending", hold_expires_at: at(5) }, NOW)).toBe(false);
  });

  it("the countdown is whole seconds, never below zero", () => {
    expect(holdSecondsLeft(at(5), NOW)).toBe(300);
    expect(holdSecondsLeft(new Date(NOW + 1500).toISOString(), NOW)).toBe(2);
    expect(holdSecondsLeft(at(-1), NOW)).toBe(0);
    expect(holdSecondsLeft(null, NOW)).toBe(0);
  });
});

describe("what a booking allows", () => {
  it("approve and decline only a pending one that has not ended", () => {
    expect(canApprove(booking("pending", 60, 90), NOW)).toBe(true);
    expect(canDecline(booking("pending", 60, 90), NOW)).toBe(true);
    expect(canApprove(booking("confirmed", 60, 90), NOW)).toBe(false);
    expect(canApprove(booking("pending", -90, -60), NOW)).toBe(false);
    expect(canDecline(booking("cancelled", 60, 90), NOW)).toBe(false);
  });

  it("move and cancel a live booking until its meeting ends; the guest's link the same", () => {
    for (const status of ["pending", "confirmed"]) {
      expect(canCancel(booking(status, 60, 90), NOW)).toBe(true);
      expect(canReschedule(booking(status, -10, 20), NOW)).toBe(true);
      expect(guestCanManage(booking(status, 60, 90), NOW)).toBe(true);
      expect(guestCanManage(booking(status, -60, -30), NOW)).toBe(false);
    }
    for (const status of ["held", "cancelled", "declined"]) {
      expect(canCancel(booking(status, 60, 90), NOW)).toBe(false);
      expect(guestCanManage(booking(status, 60, 90), NOW)).toBe(false);
    }
  });

  it("a no-show only for a confirmed meeting that has started", () => {
    expect(canMarkNoShow(booking("confirmed", -10, 20), NOW)).toBe(true);
    expect(canMarkNoShow(booking("confirmed", 10, 40), NOW)).toBe(false);
    expect(canMarkNoShow(booking("pending", -10, 20), NOW)).toBe(false);
  });

  it("the label tells a finished meeting and a no-show apart", () => {
    expect(bookingLabel(booking("confirmed", 60, 90), NOW)).toBe("confirmed");
    expect(bookingLabel(booking("confirmed", -90, -60), NOW)).toBe("done");
    expect(bookingLabel(booking("confirmed", -90, -60, { no_show_at: at(-50) }), NOW)).toBe("noShow");
    expect(bookingLabel(booking("pending", 60, 90), NOW)).toBe("pending");
    expect(bookingLabel(booking("declined", 60, 90), NOW)).toBe("declined");
    expect(bookingLabel(booking("weird", 60, 90), NOW)).toBe("cancelled");
  });
});

describe("the meeting survey of a booked meeting", () => {
  const over = { ...booking("confirmed", -90, -60), deal_id: "d", survey_dismissed_at: null };
  it("is due for a confirmed meeting with a deal that ended in the last two weeks", () => {
    expect(surveyDue(over, false, NOW)).toBe(true);
  });
  it("not before it ends, not after two weeks, not answered, skipped, a no-show or without a deal", () => {
    expect(surveyDue({ ...over, ends_at: at(10) }, false, NOW)).toBe(false);
    expect(surveyDue({ ...over, ends_at: at(-15 * 24 * 60) }, false, NOW)).toBe(false);
    expect(surveyDue(over, true, NOW)).toBe(false);
    expect(surveyDue({ ...over, survey_dismissed_at: at(-1) }, false, NOW)).toBe(false);
    expect(surveyDue({ ...over, no_show_at: at(-30) }, false, NOW)).toBe(false);
    expect(surveyDue({ ...over, deal_id: null }, false, NOW)).toBe(false);
    expect(surveyDue({ ...over, status: "cancelled" }, false, NOW)).toBe(false);
  });
});

describe("database errors as the screens name them", () => {
  it("maps the raised codes", () => {
    expect(bookingProblem({ message: "slot_taken" })).toBe("slotTaken");
    expect(bookingProblem({ message: "hold_expired" })).toBe("holdExpired");
    expect(bookingProblem({ message: "rate_limited" })).toBe("rateLimited");
    expect(bookingProblem({ message: "invalid_state" })).toBe("invalidState");
    expect(bookingProblem({ message: "not_found" })).toBe("notFound");
    expect(bookingProblem({ message: "read_only" })).toBe("readOnly");
    expect(bookingProblem(new Error("boom"))).toBe("unknown");
    expect(bookingProblem(null)).toBe("unknown");
  });
});
