"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertTriangleIcon, PipetteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { normalizeHex, parseHex, toHex } from "../color";

// --- HSV, the picker's own space -----------------------------------------------

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex({ r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) });
}

/** Twelve hues around the wheel as quick picks, vivid but not neon. */
const QUICK_HUES = Array.from({ length: 12 }, (_, index) => hsvToHex({ h: index * 30, s: 0.72, v: 0.96 }));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The picker itself: a saturation / brightness plane to drag on, a hue
 * slider, twelve quick hues and the system picker for an eyedropper. The
 * plane keeps the hue while the colour is being dragged towards black or
 * white, so the slider does not jump.
 */
function ColorPicker({ value, label, onChange }: { value: string; label: string; onChange: (hex: string) => void }) {
  const t = useTranslations("settings.appearance.editor.picker");
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const lastEmitted = useRef(value);
  const planeRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // A change from outside (the HEX field, a repair) moves the picker; our own echo does not.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setHsv(hexToHsv(value));
  }, [value]);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    if (hex === lastEmitted.current) return;
    lastEmitted.current = hex;
    onChange(hex);
  };

  const planeAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    emit({
      h: hsv.h,
      s: clamp01((event.clientX - rect.left) / rect.width),
      v: clamp01(1 - (event.clientY - rect.top) / rect.height),
    });
  };

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  return (
    <div className="flex flex-col gap-3" data-color-picker="">
      <div
        ref={planeRef}
        role="slider"
        tabIndex={0}
        aria-label={t("plane")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={t("planeValue", { s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100) })}
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          planeAt(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) planeAt(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          const next = { ...hsv };
          if (event.key === "ArrowLeft") next.s = clamp01(hsv.s - step);
          else if (event.key === "ArrowRight") next.s = clamp01(hsv.s + step);
          else if (event.key === "ArrowUp") next.v = clamp01(hsv.v + step);
          else if (event.key === "ArrowDown") next.v = clamp01(hsv.v - step);
          else return;
          event.preventDefault();
          emit(next);
        }}
        className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-line-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        style={{
          backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          backgroundColor: hueHex,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
        />
      </div>
      <input
        type="range"
        aria-label={t("hue")}
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        onChange={(event) => emit({ ...hsv, h: Number(event.target.value) })}
        className="hue-slider h-11 w-full cursor-pointer"
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("quick")}>
        {QUICK_HUES.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={hex}
            onClick={() => {
              lastEmitted.current = hex;
              setHsv(hexToHsv(hex));
              onChange(hex);
            }}
            className={cn(
              "size-9 cursor-pointer rounded-full border border-canvas/40 outline-none transition-transform hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/60 motion-reduce:transition-none mouse:size-7",
              value === hex && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
        <label className="relative grid size-9 cursor-pointer place-items-center rounded-full border border-line-strong text-ink-soft hover:text-ink mouse:size-7">
          <PipetteIcon aria-hidden className="size-4" />
          <span className="sr-only">{t("system", { label })}</span>
          <input
            type="color"
            value={value}
            onChange={(event) => {
              const hex = event.target.value.toLowerCase();
              lastEmitted.current = hex;
              setHsv(hexToHsv(hex));
              onChange(hex);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/**
 * One colour of a custom theme: a swatch that opens the picker (a popover,
 * on a phone a bottom sheet) and the HEX text beside it. The text applies as
 * soon as it is a valid colour; on leaving the field a half-typed value goes
 * back to the last valid one.
 */
export function ColorField({
  id,
  label,
  value,
  warning,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  /** A contrast problem of this colour, shown under it. */
  warning?: string | null;
  onChange: (hex: string) => void;
}) {
  const t = useTranslations("settings.appearance.editor.picker");
  const isPhone = useIsPhone();
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setText(value), [value]);

  const picker = <ColorPicker value={value} label={label} onChange={onChange} />;
  const swatchClass =
    "relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-line-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/60 mouse:size-10";

  return (
    <div className="flex flex-col gap-1" data-color-field={id}>
      <label htmlFor={`${id}-hex`} className="text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Popover.Root open={open && !isPhone} onOpenChange={setOpen}>
          <Popover.Trigger
            ref={triggerRef}
            aria-label={t("open", { label })}
            data-color-swatch={id}
            className={swatchClass}
            style={{ backgroundColor: value }}
            onClick={isPhone ? () => setOpen(true) : undefined}
          />
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="start" collisionPadding={12} className="z-popover">
              <Popover.Popup
                aria-label={label}
                className={cn(
                  "w-72 origin-(--transform-origin) rounded-2xl border border-line-strong bg-surface p-3 shadow-popover outline-none",
                  "transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
                )}
              >
                {picker}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Input
          id={`${id}-hex`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-invalid={warning ? true : undefined}
          className={cn("font-mono text-sm uppercase", warning && "border-orange")}
          onChange={(event) => {
            setText(event.target.value);
            const hex = normalizeHex(event.target.value);
            if (hex && event.target.value.replace("#", "").length === 6) onChange(hex);
          }}
          onBlur={() => setText(value)}
        />
      </div>
      {warning && (
        <p className="flex items-center gap-1 text-xs text-orange">
          <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
          {warning}
        </p>
      )}
      {isPhone && (
        <BottomSheet open={open} onOpenChange={setOpen} title={label} closeLabel={t("close")} finalFocus={triggerRef}>
          <div className="pb-2">{picker}</div>
        </BottomSheet>
      )}
    </div>
  );
}
