import { describe, expect, it } from "vitest";
import {
  EYE_TRAVEL,
  JARVIS_DIRECTIONS,
  JARVIS_STATES,
  directionVector,
  lookToward,
  nextBlinkDelay,
  nextTiltDelay,
  pointingArms,
  poseFor,
} from "./jarvis-pose";

describe("poseFor", () => {
  it("only follows the pointer while idle", () => {
    for (const state of JARVIS_STATES) {
      expect(poseFor(state).trackPointer).toBe(state === "idle");
    }
  });

  it("gives each emotion its own eyes and mouth", () => {
    expect(poseFor("happy")).toMatchObject({ eyes: "arc", mouth: "wide" });
    expect(poseFor("sleeping")).toMatchObject({ eyes: "closed" });
    expect(poseFor("surprised")).toMatchObject({ eyes: "open", mouth: "o" });
    expect(poseFor("surprised").eyeScaleY).toBeGreaterThan(1);
    expect(poseFor("thinking").eyeScaleY).toBeLessThan(1);
    expect(poseFor("thinking").lean).not.toBe(0);
  });

  it("dims the antenna while asleep", () => {
    expect(poseFor("sleeping").antennaGlow).toBeLessThan(poseFor("idle").antennaGlow);
  });

  it("raises the right arm to wave and tilts the head", () => {
    const pose = poseFor("waving");
    expect(pose.rightArm).toBeLessThan(-90);
    expect(pose.headTilt).not.toBe(0);
  });

  it("points with the arm on the side of the direction and looks there", () => {
    const right = poseFor("pointing", "right");
    expect(right.rightArm).toBe(-90);
    expect(right.eyeLook.x).toBeCloseTo(EYE_TRAVEL.x);

    const left = poseFor("pointing", "left");
    expect(left.leftArm).toBe(90);
    expect(left.eyeLook.x).toBeCloseTo(-EYE_TRAVEL.x);

    expect(poseFor("pointing", "up").eyeLook.y).toBeLessThan(0);
    expect(poseFor("pointing", "down").eyeLook.y).toBeGreaterThan(0);
  });

  it("never lets an arm cross the body", () => {
    for (const direction of JARVIS_DIRECTIONS) {
      const { leftArm, rightArm } = pointingArms(direction);
      expect(leftArm).toBeGreaterThanOrEqual(0);
      expect(rightArm).toBeLessThanOrEqual(0);
    }
  });
});

describe("directionVector", () => {
  it("returns unit vectors in screen coordinates", () => {
    for (const direction of JARVIS_DIRECTIONS) {
      const v = directionVector(direction);
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    }
    expect(directionVector("up")).toEqual({ x: 0, y: -1 });
  });
});

describe("lookToward", () => {
  it("stays inside the display however far the pointer is", () => {
    const look = lookToward(10_000, -10_000, 200);
    expect(Math.abs(look.x)).toBeLessThanOrEqual(EYE_TRAVEL.x);
    expect(Math.abs(look.y)).toBeLessThanOrEqual(EYE_TRAVEL.y);
    expect(look.x).toBeGreaterThan(0);
    expect(look.y).toBeLessThan(0);
  });

  it("eases in near Jarvis instead of snapping to the edge", () => {
    expect(lookToward(20, 0, 200).x).toBeCloseTo(EYE_TRAVEL.x * 0.1);
    expect(lookToward(400, 0, 200).x).toBeCloseTo(EYE_TRAVEL.x);
  });

  it("looks straight ahead for degenerate input", () => {
    expect(lookToward(0, 0, 200)).toEqual({ x: 0, y: 0 });
    expect(lookToward(Number.NaN, 5, 200)).toEqual({ x: 0, y: 0 });
    expect(lookToward(5, 5, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("timers", () => {
  it("blinks every 4–6 seconds", () => {
    expect(nextBlinkDelay(() => 0)).toBe(4000);
    expect(nextBlinkDelay(() => 1)).toBe(6000);
    expect(nextBlinkDelay(() => 0.5)).toBe(5000);
    expect(nextBlinkDelay(() => 7)).toBe(6000);
  });

  it("tilts the head every 6–10 seconds", () => {
    expect(nextTiltDelay(() => 0)).toBe(6000);
    expect(nextTiltDelay(() => 1)).toBe(10000);
  });
});
