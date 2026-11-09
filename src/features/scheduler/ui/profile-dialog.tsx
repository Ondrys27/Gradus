"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { handleProblem, normalizeHandleInput } from "../handle";
import { handleAvailable, useUpdateProfile, writeProblem } from "../queries";
import { BIO_MAX, HEADLINE_MAX, NAME_MAX, VIDEO_LINK_MAX, type SchedulerProfile } from "../types";
import { bookingLink } from "./common";
import { videoLinkProblem } from "./setup-guide";

/** The booking page's header: handle, name, a line about the person, a short bio, the video link. */
export function ProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: SchedulerProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("scheduler.profile");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {open && <ProfileForm profile={profile} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function ProfileForm({ profile, onDone }: { profile: SchedulerProfile; onDone: () => void }) {
  const t = useTranslations("scheduler.profile");
  const tSetup = useTranslations("scheduler.setup");
  const update = useUpdateProfile(profile.id);
  const [handle, setHandle] = useState(profile.handle);
  const [name, setName] = useState(profile.display_name ?? "");
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [video, setVideo] = useState(profile.video_link ?? "");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const videoProblem = videoLinkProblem(video);

  async function submit() {
    const problem = handleProblem(handle);
    if (problem) {
      setHandleError(tSetup(`handleProblems.${problem}`));
      return;
    }
    if (videoProblem) return;
    if (handle !== profile.handle) {
      setChecking(true);
      const free = await handleAvailable(handle, profile.id).catch(() => false);
      setChecking(false);
      if (!free) {
        setHandleError(tSetup("handleProblems.taken"));
        return;
      }
    }
    update.mutate(
      {
        handle,
        display_name: name.trim() || null,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        video_link: video.trim() || null,
      },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (writeProblem(error) === "handleTaken") setHandleError(tSetup("handleProblems.taken"));
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField
        id="profile-handle"
        label={tSetup("handle")}
        error={handleError ?? undefined}
        hint={tSetup("handleHint", { link: bookingLink(handle || "…") })}
      >
        <Input
          {...fieldA11y("profile-handle", handleError, true)}
          value={handle}
          maxLength={30}
          autoComplete="off"
          onChange={(event) => {
            setHandle(normalizeHandleInput(event.target.value));
            setHandleError(null);
          }}
        />
      </FormField>
      <FormField id="profile-name" label={t("name")} hint={t("nameHint")}>
        <Input
          id="profile-name"
          value={name}
          maxLength={NAME_MAX}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField id="profile-headline" label={t("headline")} hint={t("headlineHint")}>
        <Input
          id="profile-headline"
          value={headline}
          maxLength={HEADLINE_MAX}
          onChange={(event) => setHeadline(event.target.value)}
        />
      </FormField>
      <FormField id="profile-bio" label={t("bio")}>
        <Textarea
          id="profile-bio"
          rows={4}
          value={bio}
          maxLength={BIO_MAX}
          onChange={(event) => setBio(event.target.value)}
        />
      </FormField>
      <FormField
        id="profile-video"
        label={tSetup("video")}
        error={videoProblem ? tSetup("videoProblem") : undefined}
        hint={tSetup("videoHint")}
      >
        <Input
          {...fieldA11y("profile-video", videoProblem, true)}
          type="url"
          inputMode="url"
          value={video}
          maxLength={VIDEO_LINK_MAX}
          onChange={(event) => setVideo(event.target.value)}
        />
      </FormField>
      <p className="text-xs text-ink-muted">{t("photoHint")}</p>
      {update.isError && writeProblem(update.error) !== "handleTaken" && (
        <FormAlert>{t("saveFailed")}</FormAlert>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={update.isPending || checking}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
