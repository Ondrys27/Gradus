import { describe, expect, it } from "vitest";
import {
  jitsiUrl,
  joinPhase,
  linkChangeMailDue,
  linkTaskDue,
  meetingLinkOf,
  meetingLinkProblem,
  nextPhaseAt,
  typeLacksLink,
} from "./meeting-link";

const ROOM = "gradus-abcdefghjk23";
const base = {
  locationKind: "video",
  videoSource: "profile",
  own: null,
  room: ROOM,
  profileLink: "https://meet.google.com/abc-defg-hij",
};

describe("meetingLinkOf", () => {
  it("the host's own link of the meeting wins", () => {
    expect(meetingLinkOf({ ...base, own: "https://zoom.us/j/1", videoSource: "jitsi" })).toEqual({
      source: "own",
      url: "https://zoom.us/j/1",
    });
  });

  it("the booking's room when the type asks for one, else the profile's link", () => {
    expect(meetingLinkOf({ ...base, videoSource: "jitsi" })).toEqual({
      source: "room",
      url: `https://meet.jit.si/${ROOM}`,
    });
    expect(meetingLinkOf(base)).toEqual({ source: "profile", url: base.profileLink });
  });

  it("no link at all: the host sends one", () => {
    expect(meetingLinkOf({ ...base, profileLink: null })).toEqual({ source: "none", url: null });
    // A room that is not ours is never used.
    expect(meetingLinkOf({ ...base, videoSource: "jitsi", room: "x", profileLink: "" })).toEqual({
      source: "none",
      url: null,
    });
  });

  it("only for a video meeting; a broken link is ignored", () => {
    expect(meetingLinkOf({ ...base, locationKind: "phone" })).toBeNull();
    expect(meetingLinkOf({ ...base, own: "http://insecure.example.com" })?.source).toBe("profile");
  });
});

describe("links and rooms", () => {
  it("accepts https with a host only", () => {
    expect(meetingLinkProblem("")).toBeNull();
    expect(meetingLinkProblem(" https://meet.jit.si/x ")).toBeNull();
    expect(meetingLinkProblem("http://meet.jit.si/x")).toBe("format");
    expect(meetingLinkProblem("https://localhost")).toBe("format");
    expect(meetingLinkProblem(`https://a.example.com/${"x".repeat(500)}`)).toBe("format");
  });

  it("a Jitsi room only of the database's shape", () => {
    expect(jitsiUrl(ROOM)).toBe(`https://meet.jit.si/${ROOM}`);
    expect(jitsiUrl("gradus-abcdefghjkl1")).toBeNull();
    expect(jitsiUrl("other-abcdefghjk23")).toBeNull();
    expect(jitsiUrl(null)).toBeNull();
  });

  it("a video type without a room and without the profile's link lacks a link", () => {
    expect(typeLacksLink({ location_kind: "video", video_source: "profile", profileLink: null })).toBe(true);
    expect(typeLacksLink({ location_kind: "video", video_source: "jitsi", profileLink: null })).toBe(false);
    expect(
      typeLacksLink({ location_kind: "video", video_source: "profile", profileLink: "https://a.example.com/x" }),
    ).toBe(false);
    expect(typeLacksLink({ location_kind: "phone", video_source: "profile", profileLink: null })).toBe(false);
  });
});

describe("joinPhase", () => {
  const start = "2026-12-01T10:00:00.000Z";
  const end = "2026-12-01T10:30:00.000Z";
  const at = (iso: string) => Date.parse(iso);

  it("lights up 15 minutes before the start and stays on until the end", () => {
    expect(joinPhase(start, end, at("2026-12-01T09:44:59.000Z"))).toBe("later");
    expect(joinPhase(start, end, at("2026-12-01T09:45:00.000Z"))).toBe("soon");
    expect(joinPhase(start, end, at("2026-12-01T10:29:59.000Z"))).toBe("soon");
    expect(joinPhase(start, end, at("2026-12-01T10:30:00.000Z"))).toBe("over");
  });

  it("knows when it changes next", () => {
    expect(nextPhaseAt(start, end, at("2026-12-01T08:00:00.000Z"))).toBe(at("2026-12-01T09:45:00.000Z"));
    expect(nextPhaseAt(start, end, at("2026-12-01T10:00:00.000Z"))).toBe(at(end));
    expect(nextPhaseAt(start, end, at("2026-12-01T11:00:00.000Z"))).toBeNull();
  });
});

describe("telling the guest of a new link", () => {
  const startsAt = "2026-12-01T10:00:00.000Z";
  const now = Date.parse("2026-12-01T08:00:00.000Z");
  const change = { status: "confirmed", startsAt, previous: "https://a.example.com/1", next: "https://a.example.com/2", now };

  it("only for a confirmed meeting more than an hour ahead, only when the link changed", () => {
    expect(linkChangeMailDue(change)).toBe(true);
    expect(linkChangeMailDue({ ...change, now: Date.parse("2026-12-01T09:00:00.000Z") })).toBe(false);
    expect(linkChangeMailDue({ ...change, now: Date.parse("2026-12-01T08:59:59.000Z") })).toBe(true);
    expect(linkChangeMailDue({ ...change, status: "pending" })).toBe(false);
    expect(linkChangeMailDue({ ...change, next: change.previous })).toBe(false);
  });
});

describe("linkTaskDue", () => {
  it("an hour before the start, never in the past, on a whole minute", () => {
    const start = "2026-12-01T10:00:00.000Z";
    expect(linkTaskDue(start, Date.parse("2026-11-30T10:00:00.000Z"))).toBe("2026-12-01T09:00:00.000Z");
    expect(linkTaskDue(start, Date.parse("2026-12-01T09:30:20.000Z"))).toBe("2026-12-01T09:31:00.000Z");
  });
});
