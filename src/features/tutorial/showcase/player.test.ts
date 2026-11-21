import { describe, expect, it } from "vitest";
import { createShowcasePlayer, ShowcaseStepFailed, type PlayerControl } from "./player";
import { toSrt } from "./srt";
import type { ShowcaseStep } from "./types";

/** A clock the test moves by hand: `wait` advances it, nothing really sleeps. */
function fakeClock() {
  let now = 0;
  const hooks: Array<(time: number) => void> = [];
  return {
    now: () => now,
    wait: async (ms: number) => {
      now += ms;
      for (const hook of hooks) hook(now);
    },
    at: (hook: (time: number) => void) => hooks.push(hook),
  };
}

const step = (key: string, action: Partial<ShowcaseStep> & Pick<ShowcaseStep, "kind">): ShowcaseStep =>
  ({ key, section: "dashboard", ...action }) as ShowcaseStep;

describe("createShowcasePlayer", () => {
  it("plays the steps in order, captions by itself, the rest through the driver", async () => {
    const clock = fakeClock();
    const ran: string[] = [];
    const player = createShowcasePlayer({
      steps: [
        step("1", { kind: "caption", caption: "a.goal" }),
        step("2", { kind: "click", target: { name: "nav-milestones" } }),
        step("3", { kind: "wait", ms: 500 }),
        step("4", { kind: "type", target: { name: "x" }, text: "hello" }),
        step("5", { kind: "caption", caption: null }),
      ],
      run: async (current, control) => {
        ran.push(current.key);
        await control.sleep(1000);
      },
      now: clock.now,
      wait: clock.wait,
    });
    const result = await player.play();
    expect(result.status).toBe("done");
    expect(ran).toEqual(["2", "4"]);
    expect(player.cues()).toEqual([{ caption: "a.goal", start: 0, end: 2500 }]);
  });

  it("a pause holds the playing time, and the captions' times leave it out", async () => {
    const clock = fakeClock();
    let paused = false;
    clock.at((time) => {
      if (!paused && time >= 400) {
        paused = true;
        player.pause();
      }
      if (paused && time >= 5400 && player.snapshot().status === "paused") player.resume();
    });
    const player = createShowcasePlayer({
      steps: [
        step("1", { kind: "caption", caption: "b.ask" }),
        step("2", { kind: "wait", ms: 1000 }),
        step("3", { kind: "caption", caption: "b.save" }),
        step("4", { kind: "wait", ms: 1000 }),
      ],
      run: async () => undefined,
      now: clock.now,
      wait: clock.wait,
    });
    const result = await player.play();
    expect(result.status).toBe("done");
    const cues = player.cues();
    expect(cues.map((cue) => cue.caption)).toEqual(["b.ask", "b.save"]);
    // Five seconds of pause, yet the first caption lasted one second of playing time.
    expect(cues[0]!.end - cues[0]!.start).toBeGreaterThanOrEqual(1000);
    expect(cues[0]!.end - cues[0]!.start).toBeLessThan(1100);
    expect(clock.now()).toBeGreaterThan(5000);
  });

  it("Esc stops it: no failure, the driver's next sleep throws and nothing after runs", async () => {
    const clock = fakeClock();
    const ran: string[] = [];
    const player = createShowcasePlayer({
      steps: [
        step("1", { kind: "click", target: { name: "a" } }),
        step("2", { kind: "click", target: { name: "b" } }),
      ],
      run: async (current, control: PlayerControl) => {
        ran.push(current.key);
        player.stop();
        await control.sleep(100);
      },
      now: clock.now,
      wait: clock.wait,
    });
    const result = await player.play();
    expect(result.status).toBe("stopped");
    expect(result.error).toBeNull();
    expect(ran).toEqual(["1"]);
  });

  it("a step that cannot be played fails the showcase with its key and why", async () => {
    const clock = fakeClock();
    const player = createShowcasePlayer({
      steps: [
        step("a1", { kind: "caption", caption: "a.goal" }),
        step("a2", { kind: "click", target: { name: "missing" } }),
        step("a3", { kind: "click", target: { name: "never" } }),
      ],
      run: async (current) => {
        if (current.key === "a2") throw new ShowcaseStepFailed("not found: missing");
      },
      now: clock.now,
      wait: clock.wait,
    });
    const result = await player.play();
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ step: "a2", reason: "not found: missing" });
    expect(result.caption).toBeNull();
  });

  it("toggle pauses and goes on; play twice does not start again", async () => {
    const clock = fakeClock();
    const player = createShowcasePlayer({
      steps: [step("1", { kind: "wait", ms: 10 })],
      run: async () => undefined,
      now: clock.now,
      wait: clock.wait,
    });
    expect(player.snapshot().status).toBe("idle");
    const playing = player.play();
    player.toggle();
    expect(player.snapshot().status).toBe("paused");
    player.toggle();
    expect(player.snapshot().status).toBe("playing");
    await playing;
    expect((await player.play()).status).toBe("done");
  });
});

describe("toSrt", () => {
  it("numbers the cues and writes SubRip times, moved by the offset", () => {
    expect(
      toSrt(
        [
          { caption: "Velký cíl rozdělený na malé kroky", start: 0, end: 4200 },
          { caption: "  ", start: 4200, end: 5000 },
          { caption: "Volej a posouvej kontakty dál", start: 65_250, end: 3_725_001 },
        ],
        1500,
      ),
    ).toBe(
      "1\n00:00:01,500 --> 00:00:05,700\nVelký cíl rozdělený na malé kroky\n\n" +
        "2\n00:01:06,750 --> 01:02:06,501\nVolej a posouvej kontakty dál\n",
    );
  });

  it("leaves out cues without length", () => {
    expect(toSrt([{ caption: "x", start: 10, end: 10 }])).toBe("");
  });
});
