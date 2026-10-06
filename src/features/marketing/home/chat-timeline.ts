/**
 * The Jarvis chat on the website plays itself in a loop: the user's question
 * is typed, Jarvis thinks, his answer streams in, the action button appears,
 * everything holds for a moment and fades before it starts again. Pure
 * timing, so the component only maps a clock to what is visible.
 */

export const CHAT_TIMING = {
  /** Before the first character. */
  lead: 700,
  userCharMs: 38,
  /** Between the question and the thinking dots. */
  afterUser: 450,
  thinking: 1300,
  replyCharMs: 16,
  /** From the end of the answer to the action button. */
  beforeAction: 250,
  hold: 4200,
  fade: 500,
} as const;

export type ChatTimeline = {
  userStart: number;
  userEnd: number;
  thinkingEnd: number;
  replyEnd: number;
  actionAt: number;
  fadeAt: number;
  /** Length of one loop in ms. */
  total: number;
};

export type ChatFrame = {
  userChars: number;
  thinking: boolean;
  replyChars: number;
  showAction: boolean;
  fading: boolean;
};

export function chatTimeline(userLength: number, replyLength: number): ChatTimeline {
  const t = CHAT_TIMING;
  const userStart = t.lead;
  const userEnd = userStart + userLength * t.userCharMs;
  const thinkingEnd = userEnd + t.afterUser + t.thinking;
  const replyEnd = thinkingEnd + replyLength * t.replyCharMs;
  const actionAt = replyEnd + t.beforeAction;
  const fadeAt = actionAt + t.hold;
  return { userStart, userEnd, thinkingEnd, replyEnd, actionAt, fadeAt, total: fadeAt + t.fade };
}

/** What is on screen `elapsed` ms after the loop started (any later loop included). */
export function chatFrameAt(
  elapsed: number,
  timeline: ChatTimeline,
  userLength: number,
  replyLength: number,
): ChatFrame {
  const at = ((elapsed % timeline.total) + timeline.total) % timeline.total;
  const userChars = Math.min(
    userLength,
    Math.max(0, Math.floor((at - timeline.userStart) / CHAT_TIMING.userCharMs)),
  );
  const replyChars =
    at < timeline.thinkingEnd
      ? 0
      : Math.min(replyLength, Math.floor((at - timeline.thinkingEnd) / CHAT_TIMING.replyCharMs));
  return {
    userChars,
    thinking: at >= timeline.userEnd + CHAT_TIMING.afterUser && at < timeline.thinkingEnd,
    replyChars,
    showAction: at >= timeline.actionAt,
    fading: at >= timeline.fadeAt,
  };
}

/** The finished conversation: shown at once with reduced motion. */
export function finalChatFrame(userLength: number, replyLength: number): ChatFrame {
  return {
    userChars: userLength,
    thinking: false,
    replyChars: replyLength,
    showAction: true,
    fading: false,
  };
}

export function sameFrame(a: ChatFrame, b: ChatFrame): boolean {
  return (
    a.userChars === b.userChars &&
    a.thinking === b.thinking &&
    a.replyChars === b.replyChars &&
    a.showAction === b.showAction &&
    a.fading === b.fading
  );
}
