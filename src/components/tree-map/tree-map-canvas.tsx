"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CrosshairIcon, MaximizeIcon, MinimizeIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  collapsedEdgePath,
  descendantCount,
  edgeLength,
  edgePath,
  fitView,
  layoutTree,
  type Box,
  type MapBranch,
  type MapLayout,
  type Size,
} from "./tree-map-layout";
import {
  BUTTON_FACTOR,
  clampScale,
  MAX_SCALE,
  MIN_SCALE,
  wheelZoomFactor,
  ZOOM_TIME,
  zoomFrame,
  type Anchor,
  type Transform,
} from "./tree-map-zoom";

/** Room around the tree inside the pannable canvas. */
const CANVAS_PAD = 48;
const MOVE = { duration: 0.4, ease: [0.16, 1, 0.3, 1] } as const;
const DROP_IN = { type: "spring", stiffness: 380, damping: 20 } as const;
const INTRO_STAGGER = 0.08;
/** Length of the travelling shine and the pause after it, in px along the edge. */
const SHINE = 26;
const SHINE_REST = 90;

/** What a node needs to know to draw itself. */
export type TreeMapNodeState = {
  /** Drawn in the hidden measuring layer: no handlers, never animated. */
  measuring: boolean;
  childCount: number;
  /** Everything below the node, shown on the collapse control when collapsed. */
  hiddenCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

type Props = {
  tree: MapBranch;
  /** Accessible name of the map region. */
  label: string;
  /** Changes whenever a node's content (and so its size) may have changed. */
  contentKey: unknown;
  renderNode: (id: string, state: TreeMapNodeState) => ReactNode;
  /** Drawn in the top-left corner over the map, e.g. a legend. */
  overlay?: ReactNode;
};

const noop = () => {};

function shift(box: Box): Box {
  return { ...box, x: box.x + CANVAS_PAD, y: box.y + CANVAS_PAD };
}

/**
 * A horizontal tree: the root on the left, branches to the right. Nodes are
 * measured in a hidden layer that never animates, laid out from those sizes,
 * then drawn (and animated) in the visible layer. Edges come in two layers: a
 * solid line and a travelling shine on the same geometry. Full screen is an
 * overlay on the same instance, not the Fullscreen API, which iOS lacks.
 * Used by the task map and the reward editor.
 */
export function TreeMap({ tree, label, contentKey, renderNode, overlay }: Props) {
  const t = useTranslations("treeMap");
  const instanceId = useId();
  const reduceMotion = useReducedMotion() ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);

  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState<Size | null>(null);
  /** While the full-screen switch animates, the viewport is not measured. */
  const transitioning = useRef(false);
  const needsCentre = useRef(true);

  const layout = useMemo(() => layoutTree(tree, sizes, collapsed), [tree, sizes, collapsed]);

  // A node added a moment ago is measured before paint; until then the last layout stays.
  const [shown, setShown] = useState<MapLayout | null>(null);
  if (layout && layout !== shown) setShown(layout);
  const current = layout ?? shown;

  const branches = useMemo(() => {
    const found = new Map<string, MapBranch>();
    const walk = (branch: MapBranch) => {
      found.set(branch.id, branch);
      branch.children.forEach(walk);
    };
    walk(tree);
    return found;
  }, [tree]);

  const measure = useCallback(() => {
    const layer = measureRef.current;
    if (!layer) return;
    const found: [string, Size][] = [];
    layer.querySelectorAll<HTMLElement>("[data-measure-id]").forEach((element) => {
      // Layout sizes, untouched by transforms. A zero size means the map is hidden
      // or not laid out yet, and is never stored.
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (width > 0 && height > 0) found.push([element.dataset.measureId!, { width, height }]);
    });
    setSizes((previous) => {
      const changed = found.filter(([id, size]) => {
        const old = previous.get(id);
        return !old || old.width !== size.width || old.height !== size.height;
      });
      if (changed.length === 0) return previous;
      const next = new Map(previous);
      changed.forEach(([id, size]) => next.set(id, size));
      return next;
    });
  }, []);

  // New or changed nodes: measure before paint so nothing is ever drawn from a guess.
  useLayoutEffect(measure, [measure, tree, contentKey]);

  // Later size changes (fonts arriving, the map becoming visible) come from the observer.
  useEffect(() => {
    const layer = measureRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(measure);
    layer.querySelectorAll("[data-measure-id]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [measure, tree, contentKey]);

  const readViewport = useCallback(() => {
    const element = containerRef.current;
    if (!element || transitioning.current) return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width === 0 || height === 0) return;
    setViewport((previous) =>
      previous?.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(readViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [readViewport]);

  /**
   * Smooth zoom: every wheel event or button press retargets one ease-out
   * animation (ZOOM_TIME), starting from wherever the map is at that moment and
   * keeping the point under the anchor in place. The library's own wheel zoom
   * is off; its jumps per event were what made the map twitchy.
   */
  const zoom = useRef<{ frame: number | null; target: number }>({ frame: null, target: 1 });

  const stopZoom = useCallback(() => {
    if (zoom.current.frame !== null) cancelAnimationFrame(zoom.current.frame);
    zoom.current.frame = null;
  }, []);

  const zoomTo = useCallback(
    (scale: number, anchor: Anchor) => {
      const api = transformRef.current;
      if (!api) return;
      const { positionX, positionY, scale: currentScale } = api.instance.state;
      const from: Transform = { x: positionX, y: positionY, scale: currentScale };
      const target = clampScale(scale);
      stopZoom();
      zoom.current.target = target;
      if (reduceMotion) {
        const view = zoomFrame(from, target, anchor, 1);
        api.setTransform(view.x, view.y, view.scale, 0);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const progress = (now - start) / ZOOM_TIME;
        const view = zoomFrame(from, target, anchor, progress);
        transformRef.current?.setTransform(view.x, view.y, view.scale, 0);
        zoom.current.frame = progress < 1 ? requestAnimationFrame(step) : null;
      };
      zoom.current.frame = requestAnimationFrame(step);
    },
    [reduceMotion, stopZoom],
  );

  /** Zoom by a factor around the middle of the viewport (the buttons). */
  const zoomBy = useCallback(
    (factor: number) => {
      const api = transformRef.current;
      const wrapper = api?.instance.wrapperComponent;
      if (!api || !wrapper) return;
      const base = zoom.current.frame !== null ? zoom.current.target : api.instance.state.scale;
      zoomTo(base * factor, { x: wrapper.clientWidth / 2, y: wrapper.clientHeight / 2 });
    },
    [zoomTo],
  );

  // Wheel and trackpad pinch: native listener, because React's wheel handler is passive.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const api = transformRef.current;
      const wrapper = api?.instance.wrapperComponent;
      if (!api || !wrapper || event.deltaY === 0) return;
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const base = zoom.current.frame !== null ? zoom.current.target : api.instance.state.scale;
      zoomTo(base * wheelZoomFactor(event, rect.height), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      stopZoom();
    };
  }, [zoomTo, stopZoom]);

  const centre = useCallback(
    (animationTime = 300, fitAll = false) => {
      const api = transformRef.current;
      const root = current?.boxes.get(tree.id);
      if (!api || !current || !viewport || !root) return;
      stopZoom();
      const view = fitView(
        { width: current.width + CANVAS_PAD * 2, height: current.height + CANVAS_PAD * 2 },
        viewport,
        root.y + CANVAS_PAD + root.height / 2,
        // The whole tree, however small it gets; otherwise small but still readable.
        fitAll ? { minScale: MIN_SCALE } : undefined,
      );
      zoom.current.target = view.scale;
      void api.setTransform(
        view.x,
        view.y,
        view.scale,
        reduceMotion ? 0 : animationTime,
        "easeOutCubic",
      );
    },
    [current, viewport, tree.id, reduceMotion, stopZoom],
  );

  // First view, and again after switching full screen.
  const centredOnce = useRef(false);
  useEffect(() => {
    if (!needsCentre.current || !current || !viewport) return;
    needsCentre.current = false;
    centre(centredOnce.current ? 300 : 0);
    centredOnce.current = true;
  }, [current, viewport, centre]);

  // Full screen switch: a short fade on the same element, then measure the new viewport.
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) {
      switched.current = true;
      return;
    }
    const element = containerRef.current;
    if (!element) return;
    transitioning.current = true;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      transitioning.current = false;
      needsCentre.current = true;
      readViewport();
    };
    const controls = reduceMotion
      ? null
      : animate(element, { opacity: [0, 1] }, { duration: 0.2, ease: "easeOut" });
    if (controls) void controls.then(done);
    else requestAnimationFrame(done);
    return () => {
      cancelled = true;
      controls?.stop();
      transitioning.current = false;
    };
  }, [fullscreen, reduceMotion, readViewport]);

  // Full screen: Esc closes it (unless a dialog is open on top) and the page behind stays put.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role='dialog'][data-open], [role='alertdialog'][data-open]")) {
        return;
      }
      setFullscreen(false);
    };
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      html.style.overflow = overflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  // Which nodes were on screen after the last commit; anything else is new and drops in.
  const known = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (current) known.current = new Set(current.boxes.keys());
  }, [current]);
  const intro = known.current.size === 0;

  const parentOf = useMemo(
    () => new Map(current?.edges.map((edge) => [edge.childId, edge.parentId]) ?? []),
    [current],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const stateOf = (id: string): TreeMapNodeState => {
    const branch = branches.get(id);
    return {
      measuring: false,
      childCount: branch?.children.length ?? 0,
      hiddenCount: branch ? descendantCount(branch) : 0,
      collapsed: collapsed.has(id),
      onToggleCollapsed: () => toggleCollapsed(id),
    };
  };
  const measuringState: TreeMapNodeState = {
    measuring: true,
    childCount: 0,
    hiddenCount: 0,
    collapsed: false,
    onToggleCollapsed: noop,
  };

  // Unique per instance and edge: the geometry is defined once and drawn twice through <use>.
  const edgePrefix = `tree-map-edge-${instanceId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      // Double click on empty space shows the whole tree.
      onDoubleClick={(event) => {
        if ((event.target as Element).closest("[data-map-node], [data-map-ui]")) return;
        centre(300, true);
      }}
      className={cn(
        "overflow-hidden [background-image:radial-gradient(color-mix(in_oklab,var(--color-line)_55%,transparent)_1px,transparent_1.5px)] [background-size:22px_22px]",
        fullscreen
          ? "fixed inset-0 z-overlay h-dvh bg-canvas"
          : "relative h-[min(68dvh,640px)] min-h-96 rounded-2xl border border-line/70 bg-canvas-deep/50",
      )}
    >
      <TransformWrapper
        ref={transformRef}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        wheel={{ disabled: true }}
        // Finger pinch on touch screens stays with the library, within the same range.
        pinch={{ step: 5 }}
        zoomAnimation={{ size: 0, animationType: "easeOutQuad" }}
        // A pan glides to a stop instead of halting (the library uses the zoom
        // animation's curve for it).
        velocityAnimation={{
          disabled: reduceMotion,
          sensitivityMouse: 1,
          sensitivityTouch: 1.2,
          inertia: 1,
          animationTime: 450,
          maxAnimationTime: 900,
        }}
        onPanningStart={stopZoom}
        onPinchStart={stopZoom}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          {current && (
            <div
              className="relative"
              style={{
                width: current.width + CANVAS_PAD * 2,
                height: current.height + CANVAS_PAD * 2,
              }}
            >
              <svg
                aria-hidden
                className="pointer-events-none absolute top-0 left-0 overflow-visible"
                width={current.width + CANVAS_PAD * 2}
                height={current.height + CANVAS_PAD * 2}
              >
                <AnimatePresence>
                  {current.edges.map(({ parentId, childId }) => {
                    const from = shift(current.boxes.get(parentId)!);
                    const to = shift(current.boxes.get(childId)!);
                    const isNew = !known.current.has(childId);
                    const length = edgeLength(from, to);
                    const geometryId = `${edgePrefix}-${childId}`;
                    return (
                      <motion.g
                        key={childId}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.2 }}
                      >
                        <defs>
                          <motion.path
                            id={geometryId}
                            initial={isNew ? { d: collapsedEdgePath(from) } : false}
                            animate={{ d: edgePath(from, to) }}
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : { ...MOVE, delay: intro ? from.depth * INTRO_STAGGER : 0 }
                            }
                          />
                        </defs>
                        {/* Base: solid violet, no gradient, always visible. */}
                        <use
                          href={`#${geometryId}`}
                          fill="none"
                          stroke="var(--color-violet)"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        {/* Shine: a short dash travelling slowly along the same path. */}
                        <use
                          href={`#${geometryId}`}
                          fill="none"
                          stroke="var(--color-ink)"
                          strokeOpacity={0.85}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeDasharray={`${SHINE} ${length + SHINE_REST}`}
                          className="animate-edge-shine motion-reduce:hidden"
                          style={
                            {
                              "--edge-period": `${length + SHINE + SHINE_REST}px`,
                              animationDelay: `${from.depth * 0.4}s`,
                            } as CSSProperties
                          }
                        />
                      </motion.g>
                    );
                  })}
                </AnimatePresence>
              </svg>

              <AnimatePresence>
                {[...current.boxes].map(([id, layoutBox]) => {
                  const box = shift(layoutBox);
                  const isNew = !known.current.has(id);
                  const parentBox = parentOf.has(id)
                    ? shift(current.boxes.get(parentOf.get(id)!)!)
                    : null;
                  const initial = !isNew
                    ? false
                    : intro || !parentBox || reduceMotion
                      ? { x: box.x, y: box.y, opacity: 0, scale: reduceMotion ? 1 : 0.9 }
                      : {
                          x: parentBox.x + parentBox.width - box.width / 2,
                          y: parentBox.y + parentBox.height / 2 - box.height / 2 - 16,
                          opacity: 0,
                          scale: 0.4,
                        };
                  const delay = intro && !reduceMotion ? box.depth * INTRO_STAGGER : 0;

                  return (
                    <motion.div
                      key={id}
                      data-map-node
                      className="absolute top-0 left-0"
                      initial={initial}
                      animate={{ x: box.x, y: box.y, opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              x: { ...MOVE, delay },
                              y: { ...MOVE, delay },
                              opacity: { duration: 0.25, delay },
                              scale: isNew && !intro ? DROP_IN : { ...MOVE, delay },
                            }
                      }
                    >
                      {renderNode(id, stateOf(id))}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </TransformComponent>
      </TransformWrapper>

      {/* Measuring layer: the same cards, invisible and never animated. */}
      <div
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute top-0 left-0 -z-10"
      >
        {[...branches.keys()].map((id) => (
          <div key={id} data-measure-id={id} className="absolute top-0 left-0">
            {renderNode(id, measuringState)}
          </div>
        ))}
      </div>

      {overlay && (
        <div
          data-map-ui
          className={cn(
            "absolute left-3 z-10 w-max max-w-[calc(100%-24px)]",
            fullscreen ? "top-[calc(12px+env(safe-area-inset-top))]" : "top-3",
          )}
        >
          {overlay}
        </div>
      )}

      {/* Bottom left: the bottom-right corner belongs to Jarvis. */}
      <div
        data-map-ui
        role="toolbar"
        aria-label={t("controls")}
        className={cn(
          "absolute left-3 z-10 flex items-center gap-0.5 rounded-2xl border border-line/70 bg-surface/85 p-1 shadow-popover backdrop-blur-xl",
          fullscreen ? "bottom-[calc(12px+env(safe-area-inset-bottom))]" : "bottom-3",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("zoomIn")}
          onClick={() => zoomBy(BUTTON_FACTOR)}
        >
          <ZoomInIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("zoomOut")}
          onClick={() => zoomBy(1 / BUTTON_FACTOR)}
        >
          <ZoomOutIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("centre")} onClick={() => centre()}>
          <CrosshairIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
          aria-pressed={fullscreen}
          onClick={() => setFullscreen((value) => !value)}
        >
          {fullscreen ? <MinimizeIcon aria-hidden /> : <MaximizeIcon aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
