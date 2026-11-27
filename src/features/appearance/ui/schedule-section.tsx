"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { CopyIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/features/account/queries";
import { minutesOfTime, timeOfMinutes } from "@/features/scheduler/zoned";
import { useSettingsSave } from "@/features/settings/save-state";
import { track } from "@/lib/analytics/client";
import { weekdayName, weekdayShortName } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { builtinView } from "../custom-tokens";
import {
  BLOCK_CAPTION_MAX,
  BLOCK_NAME_MAX,
  copyDay,
  dayKeysOf,
  insertionStart,
  MAX_BLOCKS,
  MIN_BLOCKS,
  newBlockId,
  parseThemeSchedule,
  SCHEDULE_MODES,
  scheduleFromSuggestions,
  scheduleRefs,
  sortBlocks,
  suggestedBlocks,
  switchMode,
  type DayKey,
  type ScheduleBlock,
  type ScheduleMode,
  type ThemeSchedule,
} from "../schedule";
import { manualRef, parseThemeRef, type ThemeRef } from "../theme-ref";
import { transitionPreview } from "../transition-store";
import { ScheduleTimeline } from "./schedule-timeline";
import { useThemeOptions } from "./use-theme-options";

/** Saved a moment after the last change, like the notes: typing a name is not a save per key. */
const SAVE_DELAY_MS = 700;

/** The schedule as stored: names and captions trimmed, an empty caption is none, blocks by start. */
function cleaned(schedule: ThemeSchedule): ThemeSchedule {
  const days: ThemeSchedule["days"] = {};
  for (const key of dayKeysOf(schedule.mode)) {
    days[key] = sortBlocks(
      (schedule.days[key] ?? []).map((block) => ({
        ...block,
        name: block.name.trim().replace(/\s+/g, " "),
        caption: block.caption?.trim() ? block.caption.trim().replace(/\s+/g, " ") : null,
      })),
    );
  }
  return { v: 1, enabled: schedule.enabled, mode: schedule.mode, days };
}

function previousKey(mode: ScheduleMode, key: DayKey): DayKey {
  if (mode === "same") return "all";
  if (mode === "weekdays") return key === "weekdays" ? "weekdays" : "weekend";
  return String((Number(key) + 6) % 7) as DayKey;
}

/**
 * Settings → Appearance → "Change the theme through the day": blocks with a
 * name, a start, a theme and an optional caption, 2–8 a day; one list for
 * every day, weekdays and the weekend, or each day on its own (copy a day to
 * others). The day as a bar whose boundaries are dragged; "Preview the
 * transition" plays the moment of the selected block. One switch turns it
 * all on or off; in game mode only open themes can be picked.
 */
export function ScheduleSection() {
  const t = useTranslations("settings.appearance.schedule");
  const uiLocale = useLocale();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const { save } = useSettingsSave();
  const options = useThemeOptions();
  const stored = useMemo(() => parseThemeSchedule(settings.theme_schedule), [settings.theme_schedule]);
  const [draft, setDraft] = useState<ThemeSchedule | null>(stored);
  const [dayKey, setDayKey] = useState<DayKey>(() => dayKeysOf(stored?.mode ?? "same")[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(stored));

  // Saved elsewhere (another tab, Grady): the stored one wins when nothing is pending.
  useEffect(() => {
    const json = JSON.stringify(stored);
    // Our own save coming back (trimmed names) must not overwrite what is being typed.
    if (timer.current !== null || json === lastSaved.current) return;
    setDraft(stored);
    lastSaved.current = json;
  }, [stored]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const enabled = draft?.enabled ?? false;
  const mode = draft?.mode ?? "same";
  const keys = dayKeysOf(mode);
  const activeKey = keys.includes(dayKey) ? dayKey : keys[0];
  const blocks = draft?.days[activeKey] ?? [];
  const carried = draft ? (draft.days[previousKey(mode, activeKey)] ?? []).at(-1) ?? null : null;
  const selectedBlock = blocks.find((block) => block.id === selected) ?? blocks[0] ?? null;

  const optionByRef = useMemo(() => new Map(options.map((option) => [option.ref, option])), [options]);
  const viewOf = (ref: ThemeRef) => optionByRef.get(ref)?.view ?? builtinView("gradus");
  const valid = draft ? parseThemeSchedule(cleaned(draft)) : null;

  const persist = (next: ThemeSchedule, immediately = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const run = () => {
      timer.current = null;
      const value = parseThemeSchedule(cleaned(next));
      if (!value) return;
      const json = JSON.stringify(value);
      if (json === lastSaved.current) return;
      lastSaved.current = json;
      save({ theme_schedule: value, theme_override_until: null });
      const lists = dayKeysOf(value.mode).map((key) => value.days[key] ?? []);
      track("theme_schedule_saved", {
        enabled: value.enabled,
        mode: value.mode,
        blocks: Math.min(56, lists.reduce((sum, list) => sum + list.length, 0)),
        custom: scheduleRefs(value).some((ref) => parseThemeRef(ref)?.kind === "custom"),
      });
    };
    if (immediately) run();
    else timer.current = window.setTimeout(run, SAVE_DELAY_MS);
  };

  const change = (next: ThemeSchedule, immediately = false) => {
    setDraft(next);
    persist(next, immediately);
  };
  const setBlocks = (list: ScheduleBlock[], immediately = false) => {
    if (!draft) return;
    change({ ...draft, days: { ...draft.days, [activeKey]: list } }, immediately);
  };
  const setBlock = (id: string, patch: Partial<ScheduleBlock>, immediately = false) =>
    setBlocks(
      blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
      immediately,
    );

  const toggle = (on: boolean) => {
    if (draft) {
      change({ ...draft, enabled: on }, true);
      return;
    }
    if (!on) return;
    const current = manualRef(settings);
    const available = (theme: string) => optionByRef.get(theme as ThemeRef)?.available ?? false;
    const fresh = scheduleFromSuggestions(
      suggestedBlocks(
        { morning: t("defaults.morning"), afternoon: t("defaults.afternoon"), evening: t("defaults.evening") },
        optionByRef.get(current)?.available ? current : "gradus",
        available,
      ),
    );
    setDayKey("all");
    change(fresh, true);
  };

  const addBlock = () => {
    if (!draft || blocks.length >= MAX_BLOCKS) return;
    const index = selectedBlock ? blocks.findIndex((block) => block.id === selectedBlock.id) : blocks.length - 1;
    const order = [index, ...blocks.map((_, i) => i).filter((i) => i !== index).reverse()];
    for (const at of order) {
      const start = insertionStart(blocks, at);
      if (start === null) continue;
      const block: ScheduleBlock = {
        id: newBlockId(),
        name: t("defaults.newBlock"),
        start,
        theme: blocks[at].theme,
        caption: null,
      };
      setBlocks(sortBlocks([...blocks, block]), true);
      setSelected(block.id);
      return;
    }
  };

  const dayLabel = (key: DayKey, long = true) => {
    if (key === "all") return t("days.all");
    if (key === "weekdays") return t("days.weekdays");
    if (key === "weekend") return t("days.weekend");
    return long ? weekdayName(Number(key), uiLocale) : weekdayShortName(Number(key), uiLocale);
  };
  // Days in the user's week order.
  const orderedKeys =
    mode === "each"
      ? Array.from({ length: 7 }, (_, i) => String((format.weekStartsOn + i) % 7) as DayKey)
      : keys;

  return (
    <div className="flex flex-col gap-4" data-testid="theme-schedule">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor="settings-theme-schedule" className="text-sm font-medium text-ink">
            {t("toggle")}
          </label>
          <p className="text-[13px] text-ink-muted">{t("toggleHint")}</p>
        </div>
        <Switch id="settings-theme-schedule" checked={enabled} onCheckedChange={toggle} />
      </div>

      {draft && enabled && (
        <>
          <div role="radiogroup" aria-label={t("modeLabel")} className="flex flex-wrap gap-1.5">
            {SCHEDULE_MODES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                data-schedule-mode={option}
                onClick={() => {
                  const next = switchMode(draft, option);
                  setDayKey(dayKeysOf(option)[0]);
                  change(next, true);
                }}
                className={cn(
                  "min-h-11 cursor-pointer rounded-xl border px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                  mode === option ? "border-violet/60 bg-violet/10 text-ink" : "border-line text-ink-soft hover:border-line-strong",
                )}
              >
                {t(`modes.${option}`)}
              </button>
            ))}
          </div>

          {mode !== "same" && (
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label={t("daysLabel")} className="flex flex-1 gap-1 overflow-x-auto">
                {orderedKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeKey === key}
                    data-schedule-day={key}
                    onClick={() => setDayKey(key)}
                    className={cn(
                      "min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9",
                      activeKey === key ? "bg-surface-hover text-ink" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {dayLabel(key, mode !== "each")}
                  </button>
                ))}
              </div>
              <CopyDayMenu
                mode={mode}
                from={activeKey}
                label={dayLabel}
                onCopy={(to) => change(copyDay(draft, activeKey, to), true)}
              />
            </div>
          )}

          <ScheduleTimeline
            blocks={blocks}
            carried={carried}
            viewOf={viewOf}
            selected={selectedBlock?.id ?? null}
            onSelect={setSelected}
            onChange={(list) => setBlocks(list)}
          />

          <ul className="flex flex-col gap-2">
            {blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                selected={selectedBlock?.id === block.id}
                canRemove={blocks.length > MIN_BLOCKS}
                options={options}
                onFocus={() => setSelected(block.id)}
                onChange={(patch, immediately) => setBlock(block.id, patch, immediately)}
                onRemove={() => setBlocks(blocks.filter((item) => item.id !== block.id), true)}
                onPreview={() => {
                  const value = cleaned(draft).days[activeKey]?.find((item) => item.id === block.id);
                  if (value?.name) transitionPreview.request(value);
                }}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={blocks.length >= MAX_BLOCKS} onClick={addBlock}>
              <PlusIcon aria-hidden />
              {t("addBlock")}
            </Button>
            {blocks.length >= MAX_BLOCKS && <span className="text-[13px] text-ink-muted">{t("maxBlocks", { max: MAX_BLOCKS })}</span>}
            {!valid && <span className="text-[13px] text-pink">{t("invalid")}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function BlockRow({
  block,
  selected,
  canRemove,
  options,
  onFocus,
  onChange,
  onRemove,
  onPreview,
}: {
  block: ScheduleBlock;
  selected: boolean;
  canRemove: boolean;
  options: ReturnType<typeof useThemeOptions>;
  onFocus: () => void;
  onChange: (patch: Partial<ScheduleBlock>, immediately?: boolean) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations("settings.appearance.schedule");
  const [time, setTime] = useState(timeOfMinutes(block.start));
  useEffect(() => setTime(timeOfMinutes(block.start)), [block.start]);
  const items = options.map((option) => ({ value: option.ref, label: option.label }));
  const id = `schedule-block-${block.id}`;
  return (
    <li
      data-schedule-block={block.id}
      onFocusCapture={onFocus}
      className={cn(
        "grid grid-cols-2 gap-2 rounded-xl border p-2.5 md:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1fr)_minmax(0,1.4fr)_auto]",
        selected ? "border-violet/50 bg-violet/5" : "border-line",
      )}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`} className="text-xs text-ink-muted">
          {t("name")}
        </Label>
        <Input
          id={`${id}-name`}
          value={block.name}
          maxLength={BLOCK_NAME_MAX}
          aria-invalid={!block.name.trim() || undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-start`} className="text-xs text-ink-muted">
          {t("start")}
        </Label>
        <Input
          id={`${id}-start`}
          type="time"
          step={60}
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            const minute = minutesOfTime(event.target.value);
            if (Number.isFinite(minute) && minute < 1440) onChange({ start: minute });
          }}
        />
      </div>
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
        <span id={`${id}-theme-label`} className="text-xs text-ink-muted">
          {t("theme")}
        </span>
        <Select
          value={block.theme}
          items={items}
          onValueChange={(next) => {
            if (typeof next === "string" && next !== block.theme) onChange({ theme: next as ThemeRef }, true);
          }}
        >
          <SelectTrigger aria-labelledby={`${id}-theme-label`} data-schedule-theme={block.id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.ref} value={option.ref} disabled={!option.available}>
                {option.label}
                {!option.available && <span className="ml-2 text-xs text-ink-muted">{t("locked")}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
        <Label htmlFor={`${id}-caption`} className="text-xs text-ink-muted">
          {t("caption")}
        </Label>
        <Input
          id={`${id}-caption`}
          value={block.caption ?? ""}
          maxLength={BLOCK_CAPTION_MAX}
          placeholder={t("captionPlaceholder")}
          onChange={(event) => onChange({ caption: event.target.value })}
        />
      </div>
      <div className="col-span-2 flex items-end justify-end gap-1 md:col-span-1">
        <Button type="button" variant="ghost" size="icon" aria-label={t("preview", { name: block.name })} onClick={onPreview} data-testid="schedule-preview">
          <PlayIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("remove", { name: block.name })}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2Icon aria-hidden />
        </Button>
      </div>
    </li>
  );
}

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9";

/** "Copy this day to…": the other day lists, or all of them at once. */
function CopyDayMenu({
  mode,
  from,
  label,
  onCopy,
}: {
  mode: ScheduleMode;
  from: DayKey;
  label: (key: DayKey) => string;
  onCopy: (to: DayKey[]) => void;
}) {
  const t = useTranslations("settings.appearance.schedule");
  const others = dayKeysOf(mode).filter((key) => key !== from);
  const workdays = (["1", "2", "3", "4", "5"] as DayKey[]).filter((key) => key !== from);
  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="schedule-copy-day"
        className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-9"
      >
        <CopyIcon aria-hidden className="size-4" />
        {t("copyDay")}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-52 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item className={itemClass} onClick={() => onCopy(others)}>
              {t("copyToAll")}
            </Menu.Item>
            {mode === "each" && (
              <Menu.Item className={itemClass} onClick={() => onCopy(workdays)}>
                {t("copyToWeekdays")}
              </Menu.Item>
            )}
            {others.map((key) => (
              <Menu.Item key={key} className={itemClass} onClick={() => onCopy([key])}>
                {label(key)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
