"use client";

import {
  AVATAR_INPUT_MAX_BYTES,
  avatarOutputMime,
  sniffAvatarInput,
} from "./avatar-image";
import type { LoadedImage } from "./avatar-cropper";

export type AvatarPickError = "tooLarge" | "wrongType" | "unreadable" | "heicUnsupported";

/**
 * A picked photo, opened for the cropper: checked by size and by its first
 * bytes, then decoded by the browser itself. A HEIC photo opens where the
 * browser can decode it (Safari); elsewhere the person is told to pick a JPG.
 * The caller frees `image.url` once the cropper is done with it.
 */
export async function loadAvatarFile(
  file: File,
): Promise<{ ok: true; image: LoadedImage } | { ok: false; error: AvatarPickError }> {
  if (file.size > AVATAR_INPUT_MAX_BYTES) return { ok: false, error: "tooLarge" };
  const type = sniffAvatarInput(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!type) return { ok: false, error: "wrongType" };
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const element = new Image();
    element.onload = () =>
      resolve({
        ok: true,
        image: {
          url,
          mime: avatarOutputMime(type),
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
        },
      });
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, error: type === "image/heic" ? "heicUnsupported" : "unreadable" });
    };
    element.src = url;
  });
}
