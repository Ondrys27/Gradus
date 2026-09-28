import { describe, expect, it } from "vitest";
import { offersMeetingSurvey } from "./survey-trigger";

const meeting = { id: "m", system_key: "meeting", position: 1 };
const lead = { id: "l", system_key: "lead", position: 0 };
const offer = { id: "o", system_key: "offer", position: 2 };
const custom = { id: "c", system_key: null, position: 3 };

describe("offersMeetingSurvey", () => {
  it("asks when a deal moves on from the meeting stage", () => {
    expect(offersMeetingSurvey(meeting, offer)).toBe(true);
    expect(offersMeetingSurvey(meeting, custom)).toBe(true);
  });

  it("does not ask for other stages, moves back, or no move", () => {
    expect(offersMeetingSurvey(lead, offer)).toBe(false);
    expect(offersMeetingSurvey(meeting, lead)).toBe(false);
    expect(offersMeetingSurvey(meeting, meeting)).toBe(false);
    expect(offersMeetingSurvey(undefined, offer)).toBe(false);
  });
});
