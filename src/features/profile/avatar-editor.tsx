"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_MAX_BYTES, sniffImageType, type AvatarMime } from "./avatar-image";
import { AvatarCropper, type LoadedImage } from "./avatar-cropper";

type AvatarError = "tooLarge" | "wrongType" | "unreadable" | "uploadFailed";

/** One file per user at avatars/<user_id>/avatar; storage rules allow only that folder. */
function avatarPath(userId: string) {
  return `${userId}/avatar`;
}

export function AvatarEditor() {
  const t = useTranslations("profile.avatar");
  const { user } = useSession();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AvatarError | null>(null);
  const name = profile.display_name || profile.username || user.email;

  // Free the object URL once the cropper no longer needs it.
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
      const storage = createClient().storage.from("avatars");
      const path = avatarPath(user.id);
      const { error: uploadError } = await storage.upload(path, blob, {
        upsert: true,
        contentType: mime,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      // The version parameter makes browsers and the CDN fetch the new picture.
      const url = `${storage.getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      await updateProfile.mutateAsync({ avatar_url: url });
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
      const { error: removeError } = await createClient()
        .storage.from("avatars")
        .remove([avatarPath(user.id)]);
      if (removeError) throw removeError;
      await updateProfile.mutateAsync({ avatar_url: null });
    } catch {
      setError("uploadFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <Avatar src={profile.avatar_url} name={name} className="size-24 text-2xl" />
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              <ImageUpIcon aria-hidden />
              {profile.avatar_url ? t("change") : t("upload")}
            </Button>
            {profile.avatar_url && (
              <Button variant="ghost" onClick={remove} disabled={busy}>
                <Trash2Icon aria-hidden />
                {t("remove")}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-muted">{t("requirements")}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}

      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => !busy && setOpen(next)}
        title={t("cropTitle")}
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
