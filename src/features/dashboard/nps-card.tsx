"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { npsEligible } from "./nps-trigger";

const SCORE_MAX = 10;
const chip =
  "inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-2.5 text-sm font-medium tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9 mouse:min-w-9";
const chipOn = "border-violet bg-violet/20 text-ink";
const chipOff = "border-line text-ink-soft hover:border-line-strong hover:text-ink";

/**
 * A quiet card asking "how likely would you recommend Gradus", once, after
 * seven days of use. It can be closed without answering; either way it never
 * shows again (profiles.nps_asked_at).
 */
export function NpsCard() {
  const t = useTranslations("dashboard.nps");
  const reduceMotion = useReducedMotion();
  const { user } = useSession();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);

  const show = !hidden && npsEligible(profile.created_at, profile.nps_asked_at);

  async function markAsked() {
    try {
      await updateProfile.mutateAsync({ nps_asked_at: new Date().toISOString() });
    } catch (error) {
      console.error("[nps] could not stamp nps_asked_at", error);
    }
  }

  async function submit() {
    if (score === null || sending) return;
    setSending(true);
    setHidden(true);
    try {
      const { error } = await createClient()
        .from("nps_responses")
        .insert({ user_id: user.id, score, comment: comment.trim() || null });
      if (error) throw error;
      track("nps_submitted", { score });
    } catch (error) {
      console.error("[nps] could not save the answer", error);
    } finally {
      await markAsked();
      setSending(false);
    }
  }

  function dismiss() {
    setHidden(true);
    track("nps_dismissed", {});
    void markAsked();
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.section
          aria-label={t("question")}
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink">{t("question")}</p>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("close")}
                className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
              >
                <XIcon aria-hidden className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("question")}>
                {Array.from({ length: SCORE_MAX + 1 }, (_, value) => value).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={score === value}
                    onClick={() => setScore(value)}
                    className={cn(chip, score === value ? chipOn : chipOff)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-xs text-ink-muted">
                <span>{t("low")}</span>
                <span>{t("high")}</span>
              </div>
            </div>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, 500))}
              placeholder={t("commentPlaceholder")}
              rows={2}
              className="min-h-11 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30"
            />
            <Button
              type="button"
              size="sm"
              className="self-end"
              disabled={score === null || sending}
              onClick={() => void submit()}
            >
              {t("submit")}
            </Button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
