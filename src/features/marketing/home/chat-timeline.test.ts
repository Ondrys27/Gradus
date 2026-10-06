import { describe, expect, it } from "vitest";
import { CHAT_TIMING, chatFrameAt, chatTimeline, finalChatFrame, sameFrame } from "./chat-timeline";

const USER = 20;
const REPLY = 100;
const timeline = chatTimeline(USER, REPLY);
const frame = (ms: number) => chatFrameAt(ms, timeline, USER, REPLY);

describe("chat timeline", () => {
  it("starts empty", () => {
    expect(frame(0)).toEqual({
      userChars: 0,
      thinking: false,
      replyChars: 0,
      showAction: false,
      fading: false,
    });
  });

  it("types the question, thinks, then streams the answer", () => {
    expect(frame(timeline.userStart + 5 * CHAT_TIMING.userCharMs).userChars).toBe(5);
    const thinking = frame(timeline.userEnd + CHAT_TIMING.afterUser + 10);
    expect(thinking).toMatchObject({ userChars: USER, thinking: true, replyChars: 0 });
    const streaming = frame(timeline.thinkingEnd + 10 * CHAT_TIMING.replyCharMs);
    expect(streaming).toMatchObject({ thinking: false, replyChars: 10, showAction: false });
  });

  it("shows the action only after the full answer, then fades", () => {
    expect(frame(timeline.replyEnd).replyChars).toBe(REPLY);
    expect(frame(timeline.replyEnd).showAction).toBe(false);
    expect(frame(timeline.actionAt).showAction).toBe(true);
    expect(frame(timeline.fadeAt).fading).toBe(true);
  });

  it("loops", () => {
    expect(frame(timeline.total + 1)).toEqual(frame(1));
    expect(frame(timeline.total * 3 + timeline.actionAt)).toEqual(frame(timeline.actionAt));
  });

  it("never shows more characters than the texts have", () => {
    for (let ms = 0; ms < timeline.total; ms += 37) {
      const f = frame(ms);
      expect(f.userChars).toBeLessThanOrEqual(USER);
      expect(f.replyChars).toBeLessThanOrEqual(REPLY);
    }
  });

  it("the reduced-motion frame is the finished conversation", () => {
    expect(sameFrame(finalChatFrame(USER, REPLY), frame(timeline.actionAt + 1))).toBe(true);
  });
});
