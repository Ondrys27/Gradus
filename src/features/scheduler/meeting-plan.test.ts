import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEETING_SETTINGS,
  defaultTypeOf,
  emailDefault,
  guestNameOf,
  hostAllowed,
  parseMeetingSettings,
  planHosts,
  typeAllowed,
  type HostCandidate,
} from "./meeting-plan";

const OWNER = "owner";
const JANA = "jana";
const PETR = "petr";

const type = (id: string, duration: number, position = 0, active = true) => ({
  id,
  active,
  duration_min: duration,
  position,
});
const owner: HostCandidate = { userId: OWNER, types: [type("o15", 15), type("o45", 45, 1)] };
const jana: HostCandidate = { userId: JANA, types: [type("j30", 30)] };
const petrOff: HostCandidate = { userId: PETR, types: [type("p30", 30, 0, false)] };

describe("who a meeting from a call is for", () => {
  it("the caller picks: themselves, others only with the right (the owner always)", () => {
    const base = {
      settings: DEFAULT_MEETING_SETTINGS,
      ownerId: OWNER,
      candidates: [owner, jana, petrOff],
    };
    expect(planHosts({ ...base, callerId: JANA, canScheduleOthers: false })).toEqual({
      hosts: [JANA],
      defaultHost: JANA,
      canPick: false,
      missing: null,
    });
    // Petr has no active type: nobody books him.
    expect(planHosts({ ...base, callerId: JANA, canScheduleOthers: true })).toEqual({
      hosts: [JANA, OWNER],
      defaultHost: JANA,
      canPick: true,
      missing: null,
    });
    expect(planHosts({ ...base, callerId: OWNER, canScheduleOthers: false }).hosts).toEqual([
      OWNER,
      JANA,
    ]);
  });

  it("without a scheduler of their own the caller sets one up, or books for someone else", () => {
    const base = { settings: DEFAULT_MEETING_SETTINGS, ownerId: OWNER, candidates: [owner] };
    expect(planHosts({ ...base, callerId: PETR, canScheduleOthers: false })).toMatchObject({
      hosts: [],
      defaultHost: null,
      missing: "selfSetup",
    });
    expect(planHosts({ ...base, callerId: PETR, canScheduleOthers: true })).toMatchObject({
      hosts: [OWNER],
      canPick: true,
      missing: "selfSetup",
    });
  });

  it("'always me' and 'always one person' are the owner's decision: no right needed, no choice", () => {
    const toOwner = { ...DEFAULT_MEETING_SETTINGS, hostMode: "owner" as const };
    const plan = planHosts({
      settings: toOwner,
      ownerId: OWNER,
      callerId: JANA,
      canScheduleOthers: false,
      candidates: [owner, jana],
    });
    expect(plan).toEqual({ hosts: [OWNER], defaultHost: OWNER, canPick: false, missing: null });
    expect(hostAllowed(plan, OWNER)).toBe(true);
    expect(hostAllowed(plan, JANA)).toBe(false);

    const toJana = { ...DEFAULT_MEETING_SETTINGS, hostMode: "person" as const, hostUserId: JANA };
    expect(
      planHosts({
        settings: toJana,
        ownerId: OWNER,
        callerId: PETR,
        canScheduleOthers: false,
        candidates: [jana],
      }).hosts,
    ).toEqual([JANA]);
    // The fixed host has no scheduler: say so.
    expect(
      planHosts({
        settings: toOwner,
        ownerId: OWNER,
        callerId: JANA,
        canScheduleOthers: true,
        candidates: [jana],
      }),
    ).toMatchObject({ hosts: [], missing: "hostMissing" });
    // …unless it is the caller: one step sets it up.
    expect(
      planHosts({
        settings: toOwner,
        ownerId: OWNER,
        callerId: OWNER,
        canScheduleOthers: true,
        candidates: [],
      }),
    ).toMatchObject({ missing: "selfSetup" });
  });

  it("a person mode without a person is the caller's choice", () => {
    expect(
      parseMeetingSettings({
        host_mode: "nonsense",
        host_user_id: null,
        event_type_id: null,
        type_locked: false,
        ignore_notice: true,
      }).hostMode,
    ).toBe("caller");
    const plan = planHosts({
      settings: { ...DEFAULT_MEETING_SETTINGS, hostMode: "person", hostUserId: null },
      ownerId: OWNER,
      callerId: JANA,
      canScheduleOthers: false,
      candidates: [jana],
    });
    expect(plan.defaultHost).toBe(JANA);
  });
});

describe("which type", () => {
  it("the default of the settings when the host has it, else the one nearest 30 minutes", () => {
    expect(defaultTypeOf(owner, { eventTypeId: "o45" })).toBe("o45");
    expect(defaultTypeOf(owner, { eventTypeId: "elsewhere" })).toBe("o45");
    expect(defaultTypeOf(jana, { eventTypeId: null })).toBe("j30");
    expect(defaultTypeOf(undefined, { eventTypeId: null })).toBeNull();
  });

  it("a locked type is only the default", () => {
    const locked = { eventTypeId: "o15", typeLocked: true };
    expect(typeAllowed(owner, locked, "o15")).toBe(true);
    expect(typeAllowed(owner, locked, "o45")).toBe(false);
    expect(typeAllowed(owner, { eventTypeId: "o15", typeLocked: false }, "o45")).toBe(true);
    expect(typeAllowed(petrOff, { eventTypeId: null, typeLocked: false }, "p30")).toBe(false);
  });
});

describe("the guest", () => {
  it("the e-mail switch starts on with an address; the name is the person, else the company", () => {
    expect(emailDefault("jan@example.com")).toBe(true);
    expect(emailDefault("")).toBe(false);
    expect(emailDefault(null)).toBe(false);
    expect(emailDefault("not an address")).toBe(false);
    expect(guestNameOf({ first_name: "Jan", last_name: " Novák ", company_name: "Firma" })).toBe(
      "Jan Novák",
    );
    expect(guestNameOf({ first_name: null, last_name: null, company_name: " Firma s.r.o. " })).toBe(
      "Firma s.r.o.",
    );
  });
});
