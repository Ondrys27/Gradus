"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Grady } from "@/components/grady/grady";
import { Button, buttonVariants } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import type { GuideSection } from "../ui-map/types";
import { AskField } from "./ask-field";
import { guide, type GuideAnswerState, type OfferTrigger } from "./guide-store";

/** How long an offer of help stays when the user does not take it up. */
const OFFER_SHOWN_MS = 20_000;

/** Grady at the bottom left of the content with a card: the answer, the offer, "ask me anything else". */
function Card({
  testId,
  onClose,
  closeLabel,
  children,
}: {
  testId: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.section
      data-testid={testId}
      data-grady-tour=""
      data-capture-ignore=""
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-nav flex items-end gap-2 md:inset-x-auto md:bottom-6 md:left-[calc(var(--app-sidebar-width,0px)+24px)] md:w-[400px]"
    >
      <div className="hidden shrink-0 md:block">
        <Grady size={64} state="waving" variant="head" />
      </div>
      <div className="relative min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface/95 p-4 shadow-popover md:backdrop-blur-md">
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute top-1 right-1 grid size-11 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:size-8"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
        {children}
      </div>
    </motion.section>
  );
}

/**
 * Grady's answer to a question (30.8): while he looks, then his two or three
 * sentences and what follows from the kind of answer: show the steps on
 * screen, ask in the chat (not about using the app), write to the owner (no
 * right), suggest the feature (the app has no such thing).
 */
export function AnswerCard({
  answer,
  onShow,
  ownerHref,
  hasChat,
}: {
  answer: GuideAnswerState;
  onShow: () => void;
  /** Where a worker writes to the owner; null for the owner and in the administration. */
  ownerHref: string | null;
  /** Grady's chat is there (not in the administration). */
  hasChat: boolean;
}) {
  const t = useTranslations("tutorial");
  const plan = answer.plan;
  const close = () => guide.closeAnswer();
  const askInChat = () => {
    guide.closeAnswer();
    void import("@/features/grady/overlay-store").then(({ gradyOverlay }) =>
      gradyOverlay.ask(answer.question),
    );
  };
  return (
    <Card testId="guide-answer" onClose={close} closeLabel={t("guide.close")}>
      <p className="mb-1 pr-8 text-xs text-ink-muted">{t("guide.answer.question", { question: answer.question })}</p>
      {answer.status === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink">
          <Loader2Icon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("guide.answer.loading")}
        </p>
      ) : answer.status === "failed" || !plan ? (
        <>
          <p role="status" className="text-sm text-ink">
            {t.has(`guide.errors.${answer.code}` as never)
              ? t(`guide.errors.${answer.code}` as never)
              : t("guide.errors.other")}
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => guide.openMenu(answer.section)}>
              {t("guide.answer.askAgain")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p
            className="text-[15px] leading-relaxed text-ink"
            data-testid="guide-answer-text"
            data-guide-kind={plan.kind}
          >
            {plan.answer}
          </p>
          {plan.kind === "steps" && plan.dropped > 0 && (
            <p className="mt-1 text-xs text-ink-muted">{t("guide.answer.dropped")}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="mr-auto"
              onClick={() => guide.openMenu(answer.section)}
            >
              {t("guide.answer.askAgain")}
            </Button>
            {plan.kind === "steps" && (
              <Button size="sm" onClick={onShow} data-testid="guide-show">
                {t("guide.answer.show")}
              </Button>
            )}
            {plan.kind === "chat" && hasChat && (
              <Button size="sm" onClick={askInChat} data-testid="guide-to-chat">
                {t("guide.answer.chat")}
              </Button>
            )}
            {plan.kind === "noRight" && ownerHref && (
              <Link
                href={ownerHref}
                onClick={close}
                data-testid="guide-ask-owner"
                className={buttonVariants({ size: "sm" })}
              >
                {t("guide.answer.owner")}
              </Link>
            )}
            {plan.kind === "missing" && hasChat && (
              <Button
                size="sm"
                data-testid="guide-suggest"
                onClick={() => {
                  track("guide_idea_suggested", { section: answer.section ?? "none" });
                  guide.closeAnswer();
                  void import("@/features/grady/overlay-store").then(({ gradyOverlay }) =>
                    gradyOverlay.ask(t("guide.answer.ideaPrompt", { question: answer.question })),
                  );
                }}
              >
                {t("guide.answer.idea")}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** After a quick look: "Ask me anything else" with the field. */
export function AfterCard({ section }: { section: GuideSection }) {
  const t = useTranslations("tutorial");
  return (
    <Card testId="guide-after" onClose={() => guide.closeAfter()} closeLabel={t("guide.close")}>
      <p className="mb-2 pr-8 text-sm font-semibold text-ink">{t("guide.after")}</p>
      <AskField section={section} from="after" examples={false} autoFocus />
    </Card>
  );
}

/**
 * Grady's own offer (30.8): someone seems lost in a section ("Not sure how?
 * Tell me what you need to do", with the field), or it is their first visit
 * of a section (a quiet offer of the quick look). "Don't offer again" turns
 * both off (Settings → Grady turns them back on).
 */
export function OfferCard({
  section,
  trigger,
  onQuick,
  onOff,
}: {
  section: GuideSection;
  trigger: OfferTrigger;
  onQuick: () => void;
  onOff: () => void;
}) {
  const t = useTranslations("tutorial");
  const first = trigger === "firstVisit";
  const dismiss = () => {
    track("guide_offer", { section, trigger, outcome: "dismissed" });
    guide.closeOffer();
  };
  // A quiet offer: it goes away by itself unless the user is at it.
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const node = holder.current;
      if (node && (node.matches(":hover") || node.contains(document.activeElement))) return;
      guide.closeOffer();
    }, OFFER_SHOWN_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div ref={holder}>
      <Card testId="guide-offer" onClose={dismiss} closeLabel={t("guide.close")}>
        <p className="mb-2 pr-8 text-sm font-semibold text-ink">
          {first
            ? t("guide.offer.firstVisit", { section: t(`guides.${section}.name`) })
            : t("guide.offer.lost")}
        </p>
        {first ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="mr-auto" onClick={onOff}>
              {t("guide.offer.off")}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              {t("guide.offer.later")}
            </Button>
            <Button size="sm" onClick={onQuick} data-testid="guide-offer-quick">
              {t("guide.offer.quick")}
            </Button>
          </div>
        ) : (
          <>
            <AskField section={section} from="bubble" examples={false} />
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" onClick={onOff}>
                {t("guide.offer.off")}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
