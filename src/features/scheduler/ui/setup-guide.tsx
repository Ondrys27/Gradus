"use client";

import { useState } from "react";
import { AtSignIcon, ClockIcon, VideoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics/client";
import { handleProblem, normalizeHandleInput } from "../handle";
import { handleAvailable, useUpdateProfile, writeProblem } from "../queries";
import { VIDEO_LINK_MAX, type SchedulerProfile } from "../types";
import { bookingLink } from "./common";

/** A video link the scheduler accepts: https with a host (Meet, Teams, Zoom, Jitsi, any other). */
export function videoLinkProblem(value: string): "format" | null {
  const link = value.trim();
  if (!link) return null;
  if (link.length > VIDEO_LINK_MAX || !/^https:\/\/[^\s/?#]+\.[^\s]+$/.test(link)) return "format";
  return null;
}

/**
 * The first open: three steps on one card — the handle of the public link,
 * the permanent video link and the working hours (set in Availability).
 * Done or skipped, it does not come back.
 */
export function SetupGuide({
  profile,
  onOpenHours,
}: {
  profile: SchedulerProfile;
  onOpenHours: () => void;
}) {
  const t = useTranslations("scheduler.setup");
  const update = useUpdateProfile(profile.id);
  const [handle, setHandle] = useState(profile.handle);
  const [video, setVideo] = useState(profile.video_link ?? "");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const problem = handleProblem(handle);
  const videoProblem = videoLinkProblem(video);

  async function finish(skipped: boolean) {
    setHandleError(null);
    if (skipped) {
      update.mutate({ setup_done_at: new Date().toISOString() });
      track("scheduler_setup_completed", {
        video_link: Boolean(profile.video_link),
        skipped: true,
      });
      return;
    }
    if (problem) {
      setHandleError(t(`handleProblems.${problem}`));
      return;
    }
    if (videoProblem) return;
    if (handle !== profile.handle) {
      setChecking(true);
      const free = await handleAvailable(handle, profile.id).catch(() => false);
      setChecking(false);
      if (!free) {
        setHandleError(t("handleProblems.taken"));
        return;
      }
    }
    update.mutate(
      { handle, video_link: video.trim() || null, setup_done_at: new Date().toISOString() },
      {
        onSuccess: () =>
          track("scheduler_setup_completed", { video_link: Boolean(video.trim()), skipped: false }),
        onError: (error) => {
          if (writeProblem(error) === "handleTaken") setHandleError(t("handleProblems.taken"));
        },
      },
    );
  }

  return (
    <section
      aria-labelledby="scheduler-setup-title"
      data-testid="scheduler-setup"
      className="flex flex-col gap-5 rounded-3xl border border-violet/40 bg-violet/8 p-5 sm:p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 id="scheduler-setup-title" className="text-lg font-semibold text-ink">
          {t("title")}
        </h2>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>
      <ol className="flex flex-col gap-5">
        <li className="flex gap-3">
          <StepIcon>
            <AtSignIcon aria-hidden className="size-4" />
          </StepIcon>
          <FormField
            id="setup-handle"
            label={t("handle")}
            error={handleError ?? undefined}
            hint={t("handleHint", { link: bookingLink(handle || "…") })}
            className="min-w-0 flex-1"
          >
            <Input
              {...fieldA11y("setup-handle", handleError, true)}
              value={handle}
              maxLength={30}
              autoComplete="off"
              onChange={(event) => {
                setHandle(normalizeHandleInput(event.target.value));
                setHandleError(null);
              }}
            />
          </FormField>
        </li>
        <li className="flex gap-3">
          <StepIcon>
            <VideoIcon aria-hidden className="size-4" />
          </StepIcon>
          <FormField
            id="setup-video"
            label={t("video")}
            error={videoProblem ? t("videoProblem") : undefined}
            hint={t("videoHint")}
            className="min-w-0 flex-1"
          >
            <Input
              {...fieldA11y("setup-video", videoProblem, true)}
              type="url"
              inputMode="url"
              placeholder="https://meet.google.com/abc-defg-hij"
              value={video}
              maxLength={VIDEO_LINK_MAX}
              onChange={(event) => setVideo(event.target.value)}
            />
          </FormField>
        </li>
        <li className="flex gap-3">
          <StepIcon>
            <ClockIcon aria-hidden className="size-4" />
          </StepIcon>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm font-medium text-ink">{t("hours")}</p>
            <p className="text-[13px] text-ink-muted">{t("hoursHint")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={onOpenHours}
            >
              {t("hoursAction")}
            </Button>
          </div>
        </li>
      </ol>
      {update.isError && writeProblem(update.error) !== "handleTaken" && (
        <FormAlert>{t("saveFailed")}</FormAlert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void finish(false)}
          disabled={update.isPending || checking}
        >
          {t("done")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void finish(true)}
          disabled={update.isPending}
        >
          {t("skip")}
        </Button>
      </div>
    </section>
  );
}

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-7 grid size-8 shrink-0 place-items-center rounded-full border border-violet/40 bg-violet/12 text-violet">
      {children}
    </span>
  );
}
