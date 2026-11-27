"use client";

import { useSyncExternalStore } from "react";
import type { GuideSection } from "../ui-map/types";
import type { GuidePlan } from "./plan";
import type { GuideStep } from "./player";
import type { GuideAnswerRequest } from "./protocol";
import type { GuideDepth } from "./section-guide";
import type { StruggleReason } from "./struggle";

/**
 * The guide of 30.8 on screen, kept in memory for the browser session: the
 * menu of the "?" (opened from the header, the ? key or Grady's offer), the
 * answer Grady is writing or wrote to a question, the steps being played and
 * an offer of help. Anything in the app asks through `guide` (the header's
 * button, ⌘K, a chat answer); the host (guide-host.tsx) draws it.
 */

export type GuideKind = GuideDepth | "custom";
export type GuideFrom = NonNullable<GuideAnswerRequest["from"]>;
export type OfferTrigger = StruggleReason | "firstVisit";

export type GuideRun = {
  id: string;
  kind: GuideKind;
  section: GuideSection | null;
  steps: GuideStep[];
  index: number;
  /** Steps Grady did for the user. */
  doneForMe: number;
};

export type GuideAnswerState = {
  id: number;
  question: string;
  section: GuideSection | null;
  from: GuideFrom;
  status: "loading" | "done" | "failed";
  plan?: GuidePlan;
  /** Why there is no answer (the plan's limit, Grady paused…). */
  code?: string;
};

type State = {
  menu: { open: boolean; section: GuideSection | null; via: "button" | "key" | "offer" };
  answer: GuideAnswerState | null;
  run: GuideRun | null;
  offer: { section: GuideSection; trigger: OfferTrigger } | null;
  /** The section a quick look just ended in: "Ask me anything else" with the field. */
  after: GuideSection | null;
};

const INITIAL: State = {
  menu: { open: false, section: null, via: "button" },
  answer: null,
  run: null,
  offer: null,
  after: null,
};

let state: State = INITIAL;
const listeners = new Set<() => void>();
let answerSeq = 0;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** A question waiting for the host (asked before the host was on the page, or from elsewhere). */
let pendingAsk: { question: string; from: GuideFrom; section: GuideSection | null } | null = null;
const askListeners = new Set<() => void>();
/** A section guide asked for from elsewhere (an empty state's "quick look", 30.9); the host starts it. */
let pendingRun: { depth: GuideDepth; section: GuideSection } | null = null;
const runListeners = new Set<() => void>();

export const guide = {
  get: () => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  openMenu: (section: GuideSection | null, via: State["menu"]["via"] = "button") =>
    set({ menu: { open: true, section, via }, offer: null, after: null }),
  closeMenu: () => set({ menu: { ...state.menu, open: false } }),
  /** Asks Grady's guide; the host sends it and shows the answer. */
  ask: (question: string, from: GuideFrom, section: GuideSection | null = null) => {
    pendingAsk = { question, from, section };
    for (const listener of askListeners) listener();
  },
  onAsk(listener: () => void): () => void {
    askListeners.add(listener);
    return () => {
      askListeners.delete(listener);
    };
  },
  takeAsk() {
    const ask = pendingAsk;
    pendingAsk = null;
    return ask;
  },
  /** Starts a section's quick or full guide from anywhere; the host plays it. */
  requestRun: (depth: GuideDepth, section: GuideSection) => {
    pendingRun = { depth, section };
    for (const listener of runListeners) listener();
  },
  onRun(listener: () => void): () => void {
    runListeners.add(listener);
    return () => {
      runListeners.delete(listener);
    };
  },
  takeRun() {
    const run = pendingRun;
    pendingRun = null;
    return run;
  },
  answerStarted(question: string, section: GuideSection | null, from: GuideFrom): number {
    answerSeq += 1;
    set({
      answer: { id: answerSeq, question, section, from, status: "loading" },
      menu: { ...state.menu, open: false },
      offer: null,
      after: null,
    });
    return answerSeq;
  },
  answerArrived(id: number, patch: Pick<GuideAnswerState, "status" | "plan" | "code">) {
    if (state.answer?.id !== id) return;
    set({ answer: { ...state.answer, ...patch } });
  },
  closeAnswer: () => set({ answer: null }),
  start(run: Omit<GuideRun, "index" | "doneForMe">) {
    set({ run: { ...run, index: 0, doneForMe: 0 }, menu: { ...state.menu, open: false }, answer: null, offer: null, after: null });
  },
  move(index: number, doneForMe = false) {
    if (!state.run) return;
    set({ run: { ...state.run, index, doneForMe: state.run.doneForMe + (doneForMe ? 1 : 0) } });
  },
  stop(after: GuideSection | null = null) {
    set({ run: null, after });
  },
  closeAfter: () => set({ after: null }),
  offer: (section: GuideSection, trigger: OfferTrigger) => set({ offer: { section, trigger } }),
  closeOffer: () => set({ offer: null }),
};

export function useGuide<T>(select: (state: State) => T): T {
  return useSyncExternalStore(
    guide.subscribe,
    () => select(state),
    () => select(INITIAL),
  );
}
