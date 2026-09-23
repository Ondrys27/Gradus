"use client";

import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  AVATAR_MAX_BYTES,
  AVATAR_OUTPUT_SIZE,
  clampPan,
  cropSquare,
  type AvatarMime,
} from "./avatar-image";

const FRAME = 264;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

export type LoadedImage = {
  url: string;
  mime: AvatarMime;
  naturalWidth: number;
  naturalHeight: number;
};

type View = { scale: number; x: number; y: number };

/**
 * Square crop with a round preview. Drag to move, pinch, scroll or use the
 * slider to zoom. The result is re-encoded, which also strips EXIF data.
 */
export function AvatarCropper({
  image,
  saving,
  onCancel,
  onSave,
}: {
  image: LoadedImage;
  saving: boolean;
  onCancel: () => void;
  onSave: (blob: Blob, mime: AvatarMime) => void;
}) {
  const t = useTranslations("profile.avatar");
  const imgRef = useRef<HTMLImageElement>(null);
  const dims = {
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    frame: FRAME,
  };
  const fit = FRAME / Math.min(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * fit;
  const height = image.naturalHeight * fit;

  const [view, setView] = useState<View>(() => ({
    scale: 1,
    x: (FRAME - width) / 2,
    y: (FRAME - height) / 2,
  }));

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);

  function zoomTo(nextScale: number, focusX = FRAME / 2, focusY = FRAME / 2) {
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const contentX = (focusX - current.x) / current.scale;
      const contentY = (focusY - current.y) / current.scale;
      return {
        scale,
        ...clampPan(dims, scale, focusX - contentX * scale, focusY - contentY * scale),
      };
    });
  }

  function localPoint(event: PointerEvent | WheelEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTo(
        (pinchStart.current.scale * distance) / pinchStart.current.distance,
        (a.x + b.x) / 2 - rect.left,
        (a.y + b.y) / 2 - rect.top,
      );
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    setView((current) => ({
      ...current,
      ...clampPan(dims, current.scale, current.x + dx, current.y + dy),
    }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const { x, y } = localPoint(event);
    zoomTo(view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), x, y);
  }

  function save() {
    const img = imgRef.current;
    if (!img) return;
    const { sx, sy, size } = cropSquare({ ...dims, ...view });
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

    const encode = (mime: AvatarMime, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    void (async () => {
      let mime = image.mime;
      let blob = await encode(mime, 0.9);
      if (blob && blob.size > AVATAR_MAX_BYTES) {
        mime = "image/jpeg";
        blob = await encode(mime, 0.85);
      }
      if (blob) onSave(blob, mime);
    })();
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        data-base-ui-swipe-ignore
        role="img"
        aria-label={t("cropArea")}
        className="relative cursor-grab touch-none overflow-hidden rounded-2xl bg-canvas-deep select-none active:cursor-grabbing"
        style={{ width: FRAME, height: FRAME }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        <img
          ref={imgRef}
          src={image.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
          style={{
            width,
            height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_color-mix(in_oklab,var(--color-canvas)_65%,transparent)] ring-2 ring-violet/70"
        />
      </div>

      <div className="flex w-full max-w-72 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("zoomOut")}
          onClick={() => zoomTo(view.scale / 1.25)}
        >
          <MinusIcon />
        </Button>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.01}
          value={view.scale}
          onChange={(event) => zoomTo(Number(event.target.value))}
          aria-label={t("zoom")}
          className="h-11 flex-1 cursor-pointer"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("zoomIn")}
          onClick={() => zoomTo(view.scale * 1.25)}
        >
          <PlusIcon />
        </Button>
      </div>

      <p className="text-center text-sm text-ink-muted">{t("cropHint")}</p>

      <div className="flex w-full gap-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button className="flex-1" onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
