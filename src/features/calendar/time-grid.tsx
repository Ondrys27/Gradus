"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatIsoTime,
  formatTime,
  isoDateToLocal,
  toZonedWallClock,
  weekdayShortName,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { toneFill } from "@/components/ui/tone";
import {
  DAY_MIN,
  layoutDay,
  MIN_BLOCK_MIN,
  minutesToTime,
  movedRange,
  rangeFromDrag,
  resizedRange,
  SNAP_MIN,
  snapMinutes,
  type PositionedItem,
  type TimeRange,
} from "./calendar-logic";
import { DayNumber } from "./day-number";
import { blockTone, ItemChip } from "./item-chip";
import type { CalendarItem, EventItem } from "./types";

const GUTTER = "3.5rem";
/** A finger has to hold this long on an event before it is picked up. */
const LONG_PRESS_MS = 350;
const MOUSE_DRAG_PX = 4;
const TOUCH_CANCEL_PX = 8;

type Drag =
  | { mode: "create"; day: IsoDate; anchor: number; current: number }
  | { mode: "move"; item: EventItem; day: IsoDate; startMin: number; grab: number }
  | { mode: "resize"; item: EventItem; day: IsoDate; endMin: number };

type Props = {
  days: IsoDate[];
  today: IsoDate;
  now: Date;
  hourPx: number;
  items: Map<IsoDate, CalendarItem[]>;
  onPickDay?: (day: IsoDate) => void;
  onOpenItem: (item: CalendarItem) => void;
  onCreate: (day: IsoDate, range: TimeRange) => void;
  onChangeEvent: (item: EventItem, range: TimeRange) => void;
};

export function TimeGrid({
  days,
  today,
  now,
  hourPx,
  items,
  onPickDay,
  onOpenItem,
  onCreate,
  onChangeEvent,
}: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const settings = useFormatSettings();
  const { timeZone } = settings;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerType = useRef<string>("mouse");
  const justDragged = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  const count = days.length;
  const nowMin = useMemo(() => {
    const wall = toZonedWallClock(now, timeZone);
    return wall.getHours() * 60 + wall.getMinutes();
  }, [now, timeZone]);

  const allDayItems = useMemo(
    () => days.map((day) => (items.get(day) ?? []).filter((item) => item.allDay)),
    [days, items],
  );
  const hasAllDay = allDayItems.some((list) => list.length > 0);
  const anyItems = days.some((day) => (items.get(day) ?? []).length > 0);

  // Open at the current time on today, otherwise at the start of the working day.
  const firstDay = days[0];
  const showsToday = days.includes(today);
  useEffect(() => {
    const target = showsToday ? Math.max(0, nowMin - 90) : 7 * 60;
    scrollRef.current?.scrollTo({ top: (target / 60) * hourPx });
    // Only when the shown period or the scale changes; the clock ticking must not scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, count, hourPx]);

  // Once an event is picked up by a long press, the page must not scroll under the finger.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const block = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };
    element.addEventListener("touchmove", block, { passive: false });
    return () => element.removeEventListener("touchmove", block);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  function update(next: Drag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  /** Column and minute under the pointer, from the measured body. */
  function locate(clientX: number, clientY: number) {
    const rect = bodyRef.current!.getBoundingClientRect();
    const column = Math.max(
      0,
      Math.min(count - 1, Math.floor(((clientX - rect.left) / rect.width) * count)),
    );
    const minutes = Math.max(
      0,
      Math.min(DAY_MIN, ((clientY - rect.top) / (hourPx * 24)) * DAY_MIN),
    );
    return { day: days[column], minutes };
  }

  function listen(handlers: {
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  }) {
    cleanup.current?.();
    const onMove = (event: PointerEvent) => handlers.move(event);
    const onUp = (event: PointerEvent) => {
      stop();
      handlers.up(event);
    };
    const onCancel = () => {
      stop();
      handlers.cancel();
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    cleanup.current = stop;
  }

  function endDrag(clickFollows: boolean) {
    if (clickFollows) {
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
    }
    update(null);
  }

  /** A mouse drag on an empty column makes a new event. */
  function startCreate(event: ReactPointerEvent<HTMLDivElement>, day: IsoDate) {
    pointerType.current = event.pointerType;
    if (event.pointerType === "touch" || event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    const anchor = snapMinutes(locate(event.clientX, event.clientY).minutes, "floor");
    update({ mode: "create", day, anchor, current: anchor });
    listen({
      move: (moveEvent) => {
        const current = dragRef.current;
        if (current?.mode !== "create") return;
        update({
          ...current,
          current: snapMinutes(locate(moveEvent.clientX, moveEvent.clientY).minutes),
        });
      },
      up: () => {
        const current = dragRef.current;
        if (current?.mode === "create") {
          onCreate(day, rangeFromDrag(day, current.anchor, current.current, timeZone));
        }
        endDrag(true);
      },
      cancel: () => endDrag(false),
    });
  }

  /** A finger only taps: the tap makes a one-hour event at that time. */
  function tapColumn(event: ReactMouseEvent<HTMLDivElement>, day: IsoDate) {
    if (event.target !== event.currentTarget || pointerType.current !== "touch") return;
    const minutes = snapMinutes(locate(event.clientX, event.clientY).minutes, "floor");
    onCreate(day, rangeFromDrag(day, minutes, minutes, timeZone));
  }

  /** Moving or resizing an event: at once with a mouse, after a long press with a finger. */
  function startItemDrag(
    event: ReactPointerEvent<HTMLElement>,
    positioned: PositionedItem,
    day: IsoDate,
    mode: "move" | "resize",
  ) {
    pointerType.current = event.pointerType;
    if (event.button !== 0) return;
    if (mode === "resize") event.stopPropagation();
    const { item } = positioned;
    const origin = { x: event.clientX, y: event.clientY };
    const touch = event.pointerType === "touch";
    let active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const begin = (x: number, y: number) => {
      active = true;
      const pointer = locate(x, y).minutes;
      if (mode === "move") {
        update({
          mode: "move",
          item,
          day,
          startMin: positioned.top,
          grab: pointer - positioned.top,
        });
      } else {
        update({ mode: "resize", item, day, endMin: positioned.top + positioned.height });
      }
      if (touch) navigator.vibrate?.(10);
    };

    if (touch) {
      timer = setTimeout(() => begin(origin.x, origin.y), LONG_PRESS_MS);
    }

    listen({
      move: (moveEvent) => {
        const distance = Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y);
        if (!active) {
          if (touch && distance > TOUCH_CANCEL_PX) {
            clearTimeout(timer);
            cleanup.current?.();
          } else if (!touch && distance > MOUSE_DRAG_PX) {
            begin(origin.x, origin.y);
          }
          return;
        }
        const here = locate(moveEvent.clientX, moveEvent.clientY);
        const current = dragRef.current;
        if (current?.mode === "move") {
          const startMin = Math.max(
            0,
            Math.min(DAY_MIN - SNAP_MIN, snapMinutes(here.minutes - current.grab)),
          );
          update({ ...current, day: here.day, startMin });
        } else if (current?.mode === "resize") {
          update({ ...current, endMin: Math.max(SNAP_MIN, snapMinutes(here.minutes)) });
        }
      },
      up: () => {
        clearTimeout(timer);
        const current = dragRef.current;
        if (active && current?.mode === "move") {
          onChangeEvent(
            current.item,
            movedRange(current.item, current.day, current.startMin, timeZone),
          );
        } else if (active && current?.mode === "resize") {
          onChangeEvent(
            current.item,
            resizedRange(current.item, current.day, current.endMin, timeZone),
          );
        }
        endDrag(active);
      },
      cancel: () => {
        clearTimeout(timer);
        endDrag(false);
      },
    });
  }

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const timedFor = (day: IsoDate) => layoutDay(items.get(day) ?? [], day, timeZone);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div
        ref={scrollRef}
        className="max-h-[72dvh] overflow-y-auto overscroll-contain md:max-h-[calc(100dvh-15rem)]"
      >
        <div className="sticky top-0 z-20 border-b border-line bg-surface">
          <div
            className="grid"
            style={{ gridTemplateColumns: `${GUTTER} repeat(${count}, minmax(0, 1fr))` }}
          >
            <div />
            {days.map((day) => {
              const date = isoDateToLocal(day);
              const head = (
                <>
                  <span className="text-xs font-semibold text-ink-muted uppercase">
                    {weekdayShortName(date.getDay(), locale)}
                  </span>
                  <DayNumber date={date} isToday={day === today} settings={settings} />
                </>
              );
              return onPickDay ? (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPickDay(day)}
                  aria-current={day === today ? "date" : undefined}
                  className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 py-1.5 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                >
                  {head}
                </button>
              ) : (
                <div
                  key={day}
                  aria-current={day === today ? "date" : undefined}
                  className="flex min-h-11 flex-col items-center justify-center gap-0.5 py-1.5"
                >
                  {head}
                </div>
              );
            })}
          </div>
          {hasAllDay && (
            <div
              className="grid border-t border-line"
              style={{ gridTemplateColumns: `${GUTTER} repeat(${count}, minmax(0, 1fr))` }}
            >
              <div className="px-1 pt-2 text-right text-[10px] leading-none font-semibold text-ink-muted uppercase">
                {t("allDayShort")}
              </div>
              {allDayItems.map((list, index) => (
                <div
                  key={days[index]}
                  className="flex min-w-0 flex-col gap-0.5 border-l border-line p-1"
                >
                  {list.map((item) => (
                    <ItemChip
                      key={item.key}
                      item={item}
                      onOpen={onOpenItem}
                      className="h-7 mouse:h-6"
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {!anyItems && (
            <p className="border-t border-line px-4 py-2 text-center text-sm text-ink-muted">
              {t("emptyDay")}
            </p>
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: `${GUTTER} minmax(0, 1fr)` }}>
          <div className="relative" style={{ height: hourPx * 24 }} aria-hidden>
            {hours.slice(1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] leading-none text-ink-muted tabular-nums"
                style={{ top: hour * hourPx }}
              >
                {formatIsoTime(minutesToTime(hour * 60), settings)}
              </span>
            ))}
          </div>
          <div ref={bodyRef} className="relative select-none" style={{ height: hourPx * 24 }}>
            {hours.map((hour) => (
              <div
                key={hour}
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-line/60"
                style={{ top: hour * hourPx }}
              />
            ))}
            {days.map((day, index) => {
              const positioned = timedFor(day).filter(
                (entry) => !(drag && drag.mode !== "create" && drag.item.key === entry.item.key),
              );
              const ghost = drag && drag.mode !== "create" && drag.day === day ? drag : null;
              const ghostBox = ghost ? ghostPosition(ghost, timedFor(day)) : null;
              return (
                <div
                  key={day}
                  role="presentation"
                  onPointerDown={(event) => startCreate(event, day)}
                  onClick={(event) => tapColumn(event, day)}
                  className={cn(
                    "absolute inset-y-0 touch-manipulation",
                    index > 0 && "border-l border-line/60",
                    drag?.mode === "create" && "cursor-ns-resize",
                  )}
                  style={{ left: `${(index / count) * 100}%`, width: `${100 / count}%` }}
                >
                  {positioned.map((entry) => (
                    <Block
                      key={entry.item.key}
                      entry={entry}
                      hourPx={hourPx}
                      onOpen={() => {
                        if (!justDragged.current) onOpenItem(entry.item);
                      }}
                      onStart={(event, mode) => startItemDrag(event, entry, day, mode)}
                    />
                  ))}
                  {ghost && ghostBox && (
                    <Block
                      entry={{ item: ghost.item, ...ghostBox, column: 0, columns: 1 }}
                      hourPx={hourPx}
                      lifted
                    />
                  )}
                  {drag?.mode === "create" && drag.day === day && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0.5 rounded-lg border border-violet/60 bg-violet/25"
                      style={{
                        top: (Math.min(drag.anchor, drag.current) / 60) * hourPx,
                        height:
                          (Math.max(SNAP_MIN, Math.abs(drag.current - drag.anchor)) / 60) * hourPx,
                      }}
                    />
                  )}
                  {day === today && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                      style={{ top: (nowMin / 60) * hourPx }}
                    >
                      <span className="-ml-1 size-2.5 rounded-full bg-pink" />
                      <span className="h-px flex-1 bg-pink" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Where the block being dragged is drawn: at the pointer, keeping its length. */
function ghostPosition(drag: Exclude<Drag, { mode: "create" }>, inDay: PositionedItem[]) {
  const original = inDay.find((entry) => entry.item.key === drag.item.key);
  if (drag.mode === "resize") {
    const top = original?.top ?? 0;
    return { top, height: Math.max(SNAP_MIN, drag.endMin - top) };
  }
  const length = Math.max(
    MIN_BLOCK_MIN,
    Math.round((drag.item.endMs - drag.item.startMs) / 60_000),
  );
  return { top: drag.startMin, height: Math.min(length, DAY_MIN - drag.startMin) };
}

type BlockProps = {
  entry: PositionedItem;
  hourPx: number;
  lifted?: boolean;
  onOpen?: () => void;
  onStart?: (event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") => void;
};

function Block({ entry, hourPx, lifted, onOpen, onStart }: BlockProps) {
  const settings = useFormatSettings();
  const { item, top, height, column, columns } = entry;
  const px = (height / 60) * hourPx;
  const width = 100 / columns;
  const start = new Date(item.startMs);
  const end = new Date(item.endMs);

  return (
    <div
      className={cn("absolute z-[5] p-px", lifted && "z-30")}
      style={{
        top: (top / 60) * hourPx,
        height: px,
        left: `${column * width}%`,
        width: `${width}%`,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        onPointerDown={(event) => onStart?.(event, "move")}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "relative flex size-full cursor-pointer flex-col items-start overflow-hidden rounded-lg border py-1 pr-1.5 pl-2.5 text-left text-xs outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/60",
          blockTone[item.tone],
          lifted && "shadow-popover ring-2 ring-white/40",
        )}
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", toneFill[item.tone])} />
        <span className="w-full truncate font-semibold">{item.title}</span>
        {px >= 40 && (
          <span className="w-full truncate opacity-80 tabular-nums">
            {formatTime(start, settings)} – {formatTime(end, settings)}
          </span>
        )}
      </button>
      {onStart && (
        <span
          aria-hidden
          onPointerDown={(event) => onStart(event, "resize")}
          className="absolute inset-x-2 bottom-0 z-10 h-3 cursor-ns-resize touch-none after:absolute after:inset-x-1/3 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-white/40 after:content-['']"
        />
      )}
    </div>
  );
}
