"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { track } from "@/lib/analytics/client";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { closeSurvey, surveyDue } from "./satisfaction-trigger";

const SCORES = [1, 2, 3, 4, 5] as const;
const TEXT_MAX = 1000;
const THANKS_MS = 2500;

const chip =
  "inline-flex h-11 min-w-11 flex-1 cursor-pointer items-center justify-center rounded-full border px-2.5 text-sm font-medium tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40 sm:flex-none mouse:h-9 mouse:min-w-9";
const chipOn = "border-violet bg-violet/20 text-ink";
const chipOff = "border-line text-ink-soft hover:border-line-strong hover:text-ink";
const field =
  "min-h-11 w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30";

const lastAnswerKey = (userId: string) => ["satisfaction", userId, "last-answer"] as const;

/** When the user last answered, read from their own answers (never stored on the profile). */
function useLastAnswer(userId: string) {
  return useQuery({
    queryKey: lastAnswerKey(userId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await createClient()
        .from("satisfaction_responses")
        .select("created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.created_at ?? null;
    },
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * The satisfaction survey on the dashboard: after 14 days of use, then 30
 * days after each answer. A close hides it until tomorrow; three closes in a
 * row hide it for a month (satisfaction-trigger.ts).
 */
export function SatisfactionCard() {
  const t = useTranslations("dashboard.satisfaction");
  const reduceMotion = useReducedMotionSafe();
  const settings = useFormatSettings();
  const { user } = useSession();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const lastAnswer = useLastAnswer(user.id);
  const [score, setScore] = useState<number | null>(null);
  const [liked, setLiked] = useState("");
  const [improve, setImprove] = useState("");
  const [state, setState] = useState<"open" | "thanks" | "gone">("open");
  const [sending, setSending] = useState(false);

  const due =
    lastAnswer.isSuccess &&
    surveyDue({
      createdAt: profile.created_at,
      lastAnswerAt: lastAnswer.data,
      snoozedUntil: profile.nps_snoozed_until,
    });
  const show = state === "thanks" || (state === "open" && due);
  const appName = { appName: APP_NAME };

  async function submit() {
    if (score === null || sending) return;
    setSending(true);
    const likedText = liked.trim() || null;
    const improveText = improve.trim() || null;
    try {
      const { error } = await createClient().from("satisfaction_responses").insert({
        user_id: user.id,
        satisfaction: score,
        liked: likedText,
        improve: improveText,
      });
      if (error) throw error;
      track("satisfaction_submitted", {
        satisfaction: score,
        liked: likedText !== null,
        improve: improveText !== null,
      });
      setState("thanks");
      window.setTimeout(() => setState("gone"), THANKS_MS);
      void queryClient.invalidateQueries({ queryKey: lastAnswerKey(user.id) });
      if (profile.nps_dismiss_streak !== 0 || profile.nps_snoozed_until !== null) {
        await updateProfile.mutateAsync({ nps_dismiss_streak: 0, nps_snoozed_until: null });
      }
    } catch (error) {
      console.error("[satisfaction] could not save the answer", error);
      setState("gone");
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    setState("gone");
    const next = closeSurvey({ streak: profile.nps_dismiss_streak, settings });
    track("satisfaction_dismissed", { streak: next.paused ? 3 : next.streak, paused: next.paused });
    updateProfile.mutate(
      { nps_dismiss_streak: next.streak, nps_snoozed_until: next.snoozedUntil },
      { onError: (error) => console.error("[satisfaction] could not save the close", error) },
    );
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.section
          aria-label={t("title", appName)}
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("title", appName)}</h2>
              {state === "open" && (
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label={t("close")}
                  className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
                >
                  <XIcon aria-hidden className="size-4" />
                </button>
              )}
            </div>

            {state === "thanks" ? (
              <p role="status" className="text-sm text-green">
                {t("thanks")}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <p id="satisfaction-question" className="text-sm text-ink-soft">
                    {t("question", appName)}
                  </p>
                  <div
                    className="flex gap-1.5"
                    role="radiogroup"
                    aria-labelledby="satisfaction-question"
                  >
                    {SCORES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={score === value}
                        aria-label={t("scoreLabel", { score: value })}
                        onClick={() => setScore(value)}
                        className={cn(chip, score === value ? chipOn : chipOff)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between gap-3 text-xs text-ink-muted sm:max-w-60">
                    <span>{t("low")}</span>
                    <span className="text-right">{t("high")}</span>
                  </div>
                </div>

                <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                  {t("liked", appName)}
                  <textarea
                    value={liked}
                    onChange={(event) => setLiked(event.target.value.slice(0, TEXT_MAX))}
                    placeholder={t("optional")}
                    rows={2}
                    className={field}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
                  {t("improve")}
                  <textarea
                    value={improve}
                    onChange={(event) => setImprove(event.target.value.slice(0, TEXT_MAX))}
                    placeholder={t("optional")}
                    rows={2}
                    className={field}
                  />
                </label>

                <Button
                  type="button"
                  size="sm"
                  className="self-end"
                  disabled={score === null || sending}
                  onClick={() => void submit()}
                >
                  {t("submit")}
                </Button>
              </>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
