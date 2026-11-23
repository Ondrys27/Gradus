"use client";

import {
  Component,
  forwardRef,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion } from "framer-motion";
import { Menu } from "@base-ui/react/menu";
import { ArrowUpRightIcon, Maximize2Icon, SettingsIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { toneSoft } from "@/components/ui/tone";
import { lockPageScroll } from "@/lib/scroll-lock";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { WIDGET_APPEARANCE } from "./appearance";
import type { WidgetKey, WidgetMeta } from "./catalog";
import type { LayoutItem, WidgetSize } from "./grid";
import { WidgetError, WidgetSkeleton, type WidgetDef, type WidgetSettings } from "./kit";
import {
  ARRIVE_SPRING,
  flightFrom,
  haptic,
  LAYOUT_SPRING,
  SHRINK_SECONDS,
  wiggleOf,
  type Rect,
} from "./motion";
import { useWidgetDef } from "./registry";

/** How long a finger rests on a widget before the board goes into editing. */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 8;
/** Widgets this far below the screen start loading before they scroll in. */
const LAZY_MARGIN = "320px";

export function widgetLayoutId(itemId: string, scope: string): string {
  return `widget-${scope}-${itemId}`;
}

/** True once the element came near the screen; then it stays (the data is cached anyway). */
function useNearScreen<T extends Element>(eager: boolean) {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_MARGIN },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);
  return { ref, near };
}

/** A widget whose code did not arrive (offline): Retry renders it again. */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <WidgetError onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

/**
 * The widget's code, then its data, in the widget's size; skeletons in its
 * shape meanwhile. Memoised: a drag re-renders the grid many times a second,
 * and the content of twenty widgets must not render along (their props do
 * not change).
 */
export const LazyWidgetBody = memo(function LazyWidgetBody({
  widget,
  size,
  settings,
}: {
  widget: WidgetKey;
  size: WidgetSize;
  settings: WidgetSettings;
}) {
  return (
    <ChunkBoundary>
      <Suspense fallback={<WidgetSkeleton size={size} />}>
        <WidgetCode widget={widget} size={size} settings={settings} />
      </Suspense>
    </ChunkBoundary>
  );
});

function WidgetCode({
  widget,
  size,
  settings,
}: {
  widget: WidgetKey;
  size: WidgetSize;
  settings: WidgetSettings;
}) {
  const def = useWidgetDef(widget);
  // Each widget calls its own data hooks: a different widget in the same place
  // must mount afresh, or React would see a different order of hooks.
  return <WidgetBody key={widget} def={def} size={size} settings={settings} />;
}

/** Loads the widget's data (once mounted) and draws it in the widget's size. */
function WidgetBody({
  def,
  size,
  settings,
}: {
  def: WidgetDef;
  size: WidgetSize;
  settings: WidgetSettings;
}) {
  const query = def.useData(settings);
  const { tone } = WIDGET_APPEARANCE[def.key];
  if (query.data === undefined) {
    return query.isError ? <WidgetError onRetry={query.refetch} /> : <WidgetSkeleton size={size} />;
  }
  const View = def.View;
  return <View size={size} data={query.data} settings={settings} tone={tone} />;
}

function isInteractive(target: EventTarget | null): boolean {
  return Boolean(
    (target as HTMLElement | null)?.closest?.(
      "a, button, input, textarea, select, label, [role='checkbox'], [role='menuitem'], [data-no-open]",
    ),
  );
}

/** Where a widget just added from the gallery flies from (its preview on screen). */
export type Arrival = { id: string; from: Rect | null };

type FrameProps = {
  item: LayoutItem;
  meta: WidgetMeta;
  name: string;
  settings: WidgetSettings;
  editing: boolean;
  /** Distinguishes several boards on one page (the company's editor). */
  scope: string;
  /** Load at once (gallery previews and the first screen) rather than when scrolled near. */
  eager?: boolean;
  /** Just added from the gallery: it flies in from its preview. */
  arrival?: Arrival | null;
  onOpen?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  onResize?: (size: WidgetSize) => void;
  onSettings?: () => void;
  /** The drag handle of dnd-kit, spread on the card in editing. */
  dragProps?: HTMLAttributes<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
  /** A placeholder left behind while the widget is dragged. */
  ghost?: boolean;
  /** The copy under the finger while dragging: lifted, with a shadow. */
  lifted?: boolean;
};

type Flight = { x: number; y: number; scaleX: number; scaleY: number; opacity: number };

/**
 * One widget on the board: its title, its content in its size, and in editing
 * the remove cross, the gear of its settings and the size menu in the corner.
 * A tap opens its detail (the content's own links and buttons keep working);
 * a long press starts editing. In editing it wiggles with its own phase,
 * glides to a new place with a spring, morphs to a new size (the content of
 * the new size fades in over the morph), flies in from the gallery and
 * shrinks away when removed.
 */
export const WidgetFrame = memo(
  forwardRef<HTMLDivElement, FrameProps>(function WidgetFrame(
    {
      item,
      meta,
      name,
      settings,
      editing,
      scope,
      eager = false,
      arrival = null,
      onOpen,
      onLongPress,
      onRemove,
      onResize,
      onSettings,
      dragProps,
      style,
      className,
      ghost = false,
      lifted = false,
    },
    forwardedRef,
  ) {
    const t = useTranslations("dashboard.board");
    const tSizes = useTranslations("dashboard.board.sizes");
    const reduceMotion = useReducedMotionSafe();
    const { ref, near } = useNearScreen<HTMLDivElement>(eager);
    const press = useRef<{ x: number; y: number; timer: number } | null>(null);
    const pressed = useRef(false);
    const { icon: Icon, tone } = WIDGET_APPEARANCE[meta.key as WidgetKey];
    const fresh = arrival?.id === item.id;

    // The flight from the gallery: measured where the widget landed, before paint.
    const [flight, setFlight] = useState<Flight | null>(null);
    const flown = useRef(false);
    useLayoutEffect(() => {
      if (!fresh || flown.current || reduceMotion || !ref.current) return;
      flown.current = true;
      const node = ref.current;
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
      const to = node.getBoundingClientRect();
      if (arrival?.from) {
        setFlight({ ...flightFrom(arrival.from, to), opacity: 0.7 });
      } else {
        setFlight({ x: 0, y: -16, scaleX: 0.6, scaleY: 0.6, opacity: 0 });
      }
    }, [fresh, arrival, reduceMotion, ref]);

    // The content of the size fades in over the morph; the first size does not.
    const [sizeSeen, setSizeSeen] = useState(item.size);
    const sizeChanged = sizeSeen !== item.size;
    if (sizeChanged) setSizeSeen(item.size);

    function setRefs(node: HTMLDivElement | null) {
      ref.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }

    function cancelPress() {
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
    }
    function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (editing || !onLongPress || event.button !== 0) return;
      pressed.current = false;
      const { clientX, clientY } = event;
      press.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          pressed.current = true;
          press.current = null;
          haptic("lift");
          onLongPress();
        }, LONG_PRESS_MS),
      };
    }
    function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const start = press.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX)
        cancelPress();
    }
    useEffect(() => cancelPress, []);

    const sizes = meta.sizes;
    const wiggle = wiggleOf(item.id);
    const hiddenUntilFlight = fresh && !flown.current && !reduceMotion;
    return (
      <motion.div
        ref={setRefs}
        layoutId={editing || ghost || lifted ? undefined : widgetLayoutId(item.id, scope)}
        layout={editing && !lifted ? true : undefined}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
        transition={
          reduceMotion
            ? { layout: { duration: 0 }, default: { duration: 0.01 } }
            : { layout: LAYOUT_SPRING, default: { duration: SHRINK_SECONDS, ease: [0.4, 0, 1, 1] } }
        }
        data-testid="widget"
        data-widget={meta.key}
        data-size={item.size}
        data-tutorial={`widget-${meta.key}`}
        style={{ ...style, ...(hiddenUntilFlight ? { visibility: "hidden" } : {}) }}
        className={cn("group/widget relative h-full min-w-0", className)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(event) => {
          if (pressed.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          // The click that ends a long press only starts editing.
          if (pressed.current) {
            pressed.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <motion.div
          key={flight ? "flown" : "still"}
          initial={flight ?? false}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
          transition={ARRIVE_SPRING}
          className="h-full"
        >
          <div
            {...(editing ? dragProps : {})}
            onClick={(event) => {
              if (editing || !onOpen || isInteractive(event.target)) return;
              onOpen();
            }}
            style={
              editing && !ghost && !lifted
                ? ({
                    animationDelay: `${wiggle.delay}s`,
                    animationDuration: `${wiggle.duration}s`,
                    "--wiggle-angle": `${wiggle.angle}deg`,
                  } as CSSProperties)
                : undefined
            }
            className={cn(
              "@container flex h-full flex-col gap-3 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-glow transition-[border-color,background-color,box-shadow] duration-200",
              !editing &&
                onOpen &&
                "cursor-pointer hover:border-line-strong hover:bg-surface-hover",
              !editing && "[-webkit-touch-callout:none]",
              editing && "cursor-grab touch-none select-none active:cursor-grabbing",
              editing &&
                !ghost &&
                !lifted &&
                "motion-safe:animate-wiggle motion-safe:[will-change:transform]",
              ghost && "border-dashed border-violet/50 bg-violet/5 opacity-50 shadow-none",
              lifted && "border-line-strong bg-surface-hover shadow-glow-strong",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-lg border [&_svg]:size-3.5",
                  toneSoft[tone],
                )}
              >
                <Icon aria-hidden />
              </span>
              {onOpen && !editing ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={onOpen}
                  className="micro-label min-w-0 cursor-pointer truncate text-left outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40"
                >
                  {name}
                </button>
              ) : (
                <span className="micro-label min-w-0 truncate">{name}</span>
              )}
            </div>
            <motion.div
              key={item.size}
              initial={sizeChanged && !reduceMotion ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.28, delay: 0.06 }}
              className={cn("flex min-h-0 flex-1 flex-col", editing && "pointer-events-none")}
              inert={editing || undefined}
            >
              {near && !ghost ? (
                <LazyWidgetBody
                  key={meta.key}
                  widget={meta.key as WidgetKey}
                  size={item.size}
                  settings={settings}
                />
              ) : (
                <WidgetSkeleton size={item.size} />
              )}
            </motion.div>
          </div>
        </motion.div>

        {editing && !ghost && !lifted && (
          <>
            {onRemove && (
              <button
                type="button"
                onClick={() => {
                  haptic("remove");
                  onRemove();
                }}
                aria-label={t("remove", { name })}
                data-testid="widget-remove"
                className={cn(editButton, "-top-2.5 -left-2.5 hover:bg-pink hover:text-canvas")}
              >
                <XIcon aria-hidden className="size-4" />
              </button>
            )}
            {onSettings && meta.settings.length > 0 && (
              <button
                type="button"
                onClick={onSettings}
                aria-label={t("settings", { name })}
                data-testid="widget-settings"
                className={cn(editButton, "-top-2.5 -right-2.5 hover:text-violet")}
              >
                <SettingsIcon aria-hidden className="size-4" />
              </button>
            )}
            {onResize && sizes.length > 1 && (
              <Menu.Root>
                <Menu.Trigger
                  aria-label={t("resize", { name })}
                  data-testid="widget-resize"
                  className={cn(editButton, "-right-2.5 -bottom-2.5 hover:text-violet")}
                >
                  <Maximize2Icon aria-hidden className="size-3.5" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="z-popover">
                    <Menu.Popup className="min-w-48 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                      {sizes.map((size) => (
                        <Menu.Item
                          key={size}
                          onClick={() => {
                            haptic();
                            onResize(size);
                          }}
                          data-testid={`widget-size-${size}`}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9",
                            size === item.size && "text-violet",
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <SizeGlyph size={size} current={size === item.size} />
                            {tSizes(size)}
                          </span>
                          <span className="text-xs text-ink-muted">{tSizes(`${size}Span`)}</span>
                        </Menu.Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            )}
          </>
        )}
      </motion.div>
    );
  }),
);

const editButton =
  "absolute z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-line-strong bg-surface-hover text-ink shadow-popover outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8";

/** The shape of a size in the size menu: 1×1, 2×1, 2×2, 4×2 cells. */
function SizeGlyph({ size, current }: { size: WidgetSize; current: boolean }) {
  const span = { S: [1, 1], M: [2, 1], L: [2, 2], XL: [4, 2] }[size];
  return (
    <span aria-hidden className="grid h-4 w-7 grid-cols-4 grid-rows-2 gap-px">
      {Array.from({ length: 8 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        const on = x < span[0] && y < span[1];
        return (
          <span
            key={index}
            className={cn(
              "rounded-[1.5px]",
              on ? (current ? "bg-violet" : "bg-ink-soft") : "bg-line/60",
            )}
          />
        );
      })}
    </span>
  );
}

/**
 * The opened widget: a large window that grows out of the widget through a
 * shared `layoutId` and shrinks back into it. More data, its actions and
 * "Open section"; Esc and a tap outside close it, on a phone it fills the screen.
 */
export function WidgetDetail({
  item,
  meta,
  name,
  settings,
  scope,
  onClose,
}: {
  item: LayoutItem;
  meta: WidgetMeta;
  name: string;
  settings: WidgetSettings;
  scope: string;
  onClose: () => void;
}) {
  const t = useTranslations("dashboard.board");
  const reduceMotion = useReducedMotionSafe();
  const panelRef = useRef<HTMLDivElement>(null);
  const { icon: Icon, tone } = WIDGET_APPEARANCE[meta.key as WidgetKey];

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const release = lockPageScroll();
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      release();
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-overlay flex items-center justify-center md:p-6"
      data-capture-ignore=""
    >
      <motion.div
        aria-hidden
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-canvas/70 max-md:bg-canvas/85 md:backdrop-blur-sm"
      />
      <motion.div
        layoutId={widgetLayoutId(item.id, scope)}
        transition={{
          layout: reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 380, damping: 38, mass: 0.9 },
        }}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={panelRef}
        tabIndex={-1}
        data-testid="widget-detail"
        className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-y-auto overscroll-contain rounded-none border-0 bg-surface p-6 pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(env(safe-area-inset-bottom)+24px)] outline-none md:h-auto md:max-h-[85dvh] md:w-[min(100%,960px)] md:rounded-3xl md:border md:border-line-strong md:p-6 md:shadow-popover"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="flex flex-col"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-ink">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg border [&_svg]:size-4",
                  toneSoft[tone],
                )}
              >
                <Icon aria-hidden />
              </span>
              <span className="truncate">{name}</span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              data-testid="widget-detail-close"
              className="-mr-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-5" />
            </button>
          </div>
          <ChunkBoundary>
            <Suspense fallback={<WidgetSkeleton size="L" />}>
              <DetailContent key={meta.key} meta={meta} settings={settings} onClose={onClose} />
            </Suspense>
          </ChunkBoundary>
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}

/** The detail's content, once the widget's code is there: more data, actions, Open section. */
function DetailContent({
  meta,
  settings,
  onClose,
}: {
  meta: WidgetMeta;
  settings: WidgetSettings;
  onClose: () => void;
}) {
  const t = useTranslations("dashboard.board");
  const def = useWidgetDef(meta.key as WidgetKey);
  const { tone } = WIDGET_APPEARANCE[meta.key as WidgetKey];
  const query = def.useData(settings);
  const href = (def.useHref ?? (() => meta.href))(settings);
  const Detail = def.Detail;
  return (
    <div className="flex flex-col gap-5">
      {query.data === undefined ? (
        query.isError ? (
          <WidgetError onRetry={query.refetch} />
        ) : (
          <WidgetSkeleton size="L" />
        )
      ) : (
        <Detail data={query.data} settings={settings} tone={tone} close={onClose} />
      )}
      {href !== "/app" && (
        <Link
          href={href}
          onClick={onClose}
          data-testid="widget-open-section"
          className={cn(buttonVariants({ variant: "outline" }), "self-start")}
        >
          {t("openSection")}
          <ArrowUpRightIcon aria-hidden data-icon="inline-end" />
        </Link>
      )}
    </div>
  );
}
