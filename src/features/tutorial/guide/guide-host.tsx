"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { gradyOverlay } from "@/features/grady/overlay-store";
import { track } from "@/lib/analytics/client";
import { sectionGuide, UI_MAP_BY_KEY } from "../ui-map";
import type { GuideAudience } from "../ui-map/access";
import type { GuideSection } from "../ui-map/types";
import { AfterCard, AnswerCard, OfferCard } from "./guide-cards";
import { GuideMenu } from "./guide-menu";
import { doStepForMe, GuideOverlay } from "./guide-overlay";
import { guide, useGuide, type GuideFrom } from "./guide-store";
import { toGuideSteps, type GuideStep } from "./player";
import type { GuideAnswerResponse } from "./protocol";
import { guideSectionOf } from "./sections";
import { sectionGuideSteps, type GuideDepth } from "./section-guide";

async function fetchAnswer(question: string, section: GuideSection | null, from: GuideFrom): Promise<GuideAnswerResponse> {
  try {
    const response = await fetch("/api/grady", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "guideAnswer", question, section, from }),
    });
    const body = (await response.json().catch(() => null)) as GuideAnswerResponse | null;
    return body ?? { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** A guide ends: walked through or left on the way; after a quick look, "Ask me anything else". */
function finish(how: "finished" | "abandoned") {
  const current = guide.get().run;
  if (!current) return;
  const props = { section: current.section ?? "none", guide: current.kind } as const;
  if (how === "finished") {
    track("guide_finished", { ...props, steps: current.steps.length, done_for_me: current.doneForMe });
  } else {
    track("guide_abandoned", { ...props, index: current.index, steps: current.steps.length });
  }
  guide.stop(how === "finished" && current.kind === "quick" ? current.section : null);
}

function runId() {
  return Math.random().toString(36).slice(2, 10);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/**
 * The guide of 30.8 in the app and the administration: the "?" menu, the
 * section guides (quick look, everything), Grady's answers to questions and
 * their steps on screen, the offers of help. The ? key opens the menu
 * anywhere outside a field. What the person has comes from `audience`;
 * the server checks the same again for every question.
 */
export function GuideHost({
  audience,
  writable,
  hasChat,
  ownerHref,
  onOffersOff,
}: {
  audience: GuideAudience;
  /** May try things in a full guide (not a read-only space). */
  writable: boolean;
  /** Grady's chat is there to hand a question over. */
  hasChat: boolean;
  /** Where a worker asks the owner for a right. */
  ownerHref: string | null;
  /** "Don't offer again" in Grady's offer. */
  onOffersOff?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const section = guideSectionOf(pathname, search);
  const run = useGuide((state) => state.run);
  const answer = useGuide((state) => state.answer);
  const after = useGuide((state) => state.after);
  const offer = useGuide((state) => state.offer);
  const menuOpen = useGuide((state) => state.menu.open);
  const sectionRef = useRef(section);
  sectionRef.current = section;

  // Everything else of Grady keeps quiet while a guide plays (proactive cards, the summary).
  useEffect(() => {
    gradyOverlay.setTourActive(run !== null);
    return () => gradyOverlay.setTourActive(false);
  }, [run]);

  // The ? key, outside fields and without a dialog open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || guide.get().run) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      track("guide_menu_opened", { section: sectionRef.current ?? "none", via: "key" });
      guide.openMenu(sectionRef.current, "key");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A question from anywhere (the menu, ⌘K, a chat answer, the offer).
  useEffect(() => {
    const send = () => {
      const ask = guide.takeAsk();
      if (!ask) return;
      const where = ask.section ?? sectionRef.current;
      const id = guide.answerStarted(ask.question, where, ask.from);
      void fetchAnswer(ask.question, where, ask.from).then((result) =>
        guide.answerArrived(
          id,
          result.ok ? { status: "done", plan: result.plan } : { status: "failed", code: result.code },
        ),
      );
    };
    send();
    return guide.onAsk(send);
  }, []);

  const start = useCallback(
    (depth: GuideDepth, where: GuideSection) => {
      const def = sectionGuide(where);
      if (!def) return;
      const steps = sectionGuideSteps({
        guide: def,
        depth,
        audience,
        elements: UI_MAP_BY_KEY,
        writable,
        runId: runId(),
      });
      track("guide_started", { section: where, guide: depth, steps: steps.length });
      guide.start({ id: runId(), kind: depth, section: where, steps });
    },
    [audience, writable],
  );

  const showAnswer = useCallback(() => {
    const current = guide.get().answer;
    if (!current?.plan) return;
    const steps = toGuideSteps(current.plan.steps, UI_MAP_BY_KEY, runId());
    if (steps.length === 0) return;
    track("guide_started", { section: current.section ?? "none", guide: "custom", steps: steps.length });
    guide.start({ id: runId(), kind: "custom", section: current.section, steps });
  }, []);

  const onNext = useCallback((forMe = false) => {
    const current = guide.get().run;
    if (!current) return;
    if (current.index + 1 >= current.steps.length) {
      finish("finished");
      return;
    }
    guide.move(current.index + 1, forMe);
  }, []);


  const onAskMore = useCallback(() => {
    const current = guide.get().run;
    finish("abandoned");
    guide.openMenu(current?.section ?? sectionRef.current);
  }, []);

  const onDoneForMe = useCallback(
    (step: GuideStep) => {
      const current = guide.get().run;
      track("guide_done_for_me", { section: current?.section ?? "none", action: step.action });
      const pressed = doStepForMe(step, (path) => router.push(path));
      // Leading somewhere is done once the page is there (the step checks it); a press moves on.
      if (pressed && step.action !== "go") window.setTimeout(() => onNext(true), 400);
    },
    [router, onNext],
  );

  const offersOff = useCallback(() => {
    const current = guide.get().offer;
    if (current) track("guide_offer", { section: current.section, trigger: current.trigger, outcome: "off" });
    guide.closeOffer();
    onOffersOff?.();
  }, [onOffersOff]);

  return (
    <>
      <GuideMenu onStart={start} />
      {run && (
        <GuideOverlay run={run} onNext={onNext} onEnd={finish} onAskMore={onAskMore} onDoneForMe={onDoneForMe} />
      )}
      {!run && answer && <AnswerCard answer={answer} onShow={showAnswer} ownerHref={ownerHref} hasChat={hasChat} />}
      {!run && !answer && !menuOpen && after && <AfterCard section={after} />}
      {!run && !answer && !menuOpen && !after && offer && (
        <OfferCard
          section={offer.section}
          trigger={offer.trigger}
          onOff={offersOff}
          onQuick={() => {
            track("guide_offer", { section: offer.section, trigger: offer.trigger, outcome: "accepted" });
            start("quick", offer.section);
          }}
        />
      )}
    </>
  );
}
