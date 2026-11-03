"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { AvatarCropper, type LoadedImage } from "@/features/profile/avatar-cropper";
import { AVATAR_MAX_BYTES, sniffImageType, type AvatarMime } from "@/features/profile/avatar-image";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useUpdateCompanyWorker } from "./queries";
import type { DashboardWorker } from "./types";

const BUCKET = "worker-avatars";

type PhotoError = "tooLarge" | "wrongType" | "unreadable" | "uploadFailed";

/** One file per person: worker-avatars/<owner>/<worker>/avatar; storage rules allow only that. */
export function workerAvatarPath(ownerId: string, workerId: string) {
  return `${ownerId}/${workerId}/avatar`;
}

/**
 * The person's photo. Whoever may change it picks a JPG or PNG (2 MB), crops
 * it to a square and it is saved at once; removing it shows the photo of the
 * person's own account again, if any.
 */
export function PhotoEditor({
  worker,
  canChange,
}: {
  worker: DashboardWorker;
  canChange: boolean;
}) {
  const t = useTranslations("profile.avatar");
  const td = useTranslations("workers.dashboard.photo");
  const ownerId = useWorkspaceId();
  const update = useUpdateCompanyWorker(worker);
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PhotoError | null>(null);

  useEffect(() => {
    if (!image) return;
    return () => URL.revokeObjectURL(image.url);
  }, [image]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > AVATAR_MAX_BYTES) return setError("tooLarge");
    const mime = sniffImageType(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    if (!mime) return setError("wrongType");
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      setImage({
        url,
        mime,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
      });
      setOpen(true);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      setError("unreadable");
    };
    element.src = url;
  }

  async function save(blob: Blob, mime: AvatarMime) {
    setBusy(true);
    setError(null);
    try {
      const storage = createClient().storage.from(BUCKET);
      const path = workerAvatarPath(ownerId, worker.id);
      const { error: uploadError } = await storage.upload(path, blob, {
        upsert: true,
        contentType: mime,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      // The version makes browsers and the CDN fetch the new picture.
      const url = `${storage.getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      await update.mutateAsync({ avatar_url: url });
      setOpen(false);
    } catch {
      setError("uploadFailed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await createClient()
        .storage.from(BUCKET)
        .remove([workerAvatarPath(ownerId, worker.id)]);
      await update.mutateAsync({ avatar_url: null });
    } catch {
      setError("uploadFailed");
    } finally {
      setBusy(false);
    }
  }

  const ownPhoto = worker.avatarUrl?.includes(`/${BUCKET}/`) ?? false;

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative">
        <Avatar src={worker.avatarUrl} name={worker.name} className="size-20 text-2xl sm:size-24" />
        {canChange && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label={worker.avatarUrl ? t("change") : t("upload")}
            data-testid="worker-photo-button"
            className={cn(
              "absolute -right-1 -bottom-1 grid size-11 cursor-pointer place-items-center rounded-full border border-line-strong bg-surface text-ink-soft shadow-glow outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
              busy && "opacity-60",
            )}
          >
            <CameraIcon aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {canChange && ownPhoto && (
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-7"
        >
          <Trash2Icon aria-hidden className="size-3.5" />
          {t("remove")}
        </button>
      )}
      {canChange && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="worker-photo-input"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      )}
      {error && (
        <p role="alert" className="max-w-40 text-center text-xs text-pink">
          {t(`errors.${error}`)}
        </p>
      )}
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => !busy && setOpen(next)}
        title={td("cropTitle", { name: worker.name })}
        closeLabel={t("cancel")}
      >
        {image && (
          <AvatarCropper
            key={image.url}
            image={image}
            saving={busy}
            onCancel={() => setOpen(false)}
            onSave={save}
          />
        )}
      </ResponsiveDialog>
    </div>
  );
}
