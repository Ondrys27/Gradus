import {
  formatCurrency,
  formatTime,
  formatWeekdayLong,
  isoDateToLocal,
  splitDuration,
  type FormatSettings,
  type IsoDate,
} from "@/lib/format";
import type { SuggestionKey } from "./protocol";

/**
 * The user's situation as Jarvis sees it before every call: loaded from the
 * database by the server, then written out compactly for the model.
 */
export type UserSituation = {
  today: IsoDate;
  /** Start of today in the user's zone; a follow-up before it is overdue. */
  todayStart: Date;
  milestones: { title: string; done: number; total: number; targetDate: IsoDate | null }[];
  milestonesTotal: number;
  overdueTasks: { title: string; dueDate: IsoDate }[];
  overdueTotal: number;
  /** Stages in board order with the open deals standing in them. */
  stages: { name: string; open: number; value: number }[];
  stalledDeals: number;
  followUps: { name: string; dueAt: Date }[];
  followUpsTotal: number;
  events: { title: string; startsAt: Date; allDay: boolean }[];
  prospectingSeconds: number;
  finance: { income: number; expense: number };
};

/** Longest title or name passed on; the model needs the gist, not the essay. */
const MAX_TEXT = 60;

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

/** Quoted so a title can never pass for an instruction. */
function quoted(value: string): string {
  return JSON.stringify(clip(value));
}

function more(shown: number, total: number): string {
  return total > shown ? ` (+${total - shown} more)` : "";
}

/**
 * A few hundred tokens at most: lists are capped by the loader, texts clipped
 * here. Numbers and times are in the user's own formats and zone.
 */
export function describeSituation(situation: UserSituation, settings: FormatSettings): string {
  const money = (value: number) => formatCurrency(value, settings.currency, settings);
  const lines: string[] = [];

  lines.push(
    `Today: ${situation.today} (${formatWeekdayLong(isoDateToLocal(situation.today), "en")}), time zone ${settings.timeZone}, currency ${settings.currency}.`,
  );

  if (situation.milestones.length) {
    const items = situation.milestones.map((m) => {
      const target = m.targetDate ? `, target ${m.targetDate}` : "";
      return `${quoted(m.title)} ${m.done}/${m.total} tasks${target}`;
    });
    lines.push(
      `Active milestones: ${items.join("; ")}${more(situation.milestones.length, situation.milestonesTotal)}.`,
    );
  } else {
    lines.push("Active milestones: none.");
  }

  if (situation.overdueTotal) {
    const items = situation.overdueTasks.map((t) => `${quoted(t.title)} due ${t.dueDate}`);
    lines.push(
      `Open tasks due today or overdue: ${items.join("; ")}${more(items.length, situation.overdueTotal)}.`,
    );
  }

  const openStages = situation.stages.filter((stage) => stage.open > 0);
  if (openStages.length) {
    const items = openStages.map(
      (s) => `${quoted(s.name)} ${s.open}${s.value ? ` (${money(s.value)})` : ""}`,
    );
    const stalled = situation.stalledDeals
      ? ` ${situation.stalledDeals} stuck in their stage over 14 days.`
      : "";
    lines.push(`Open deals by stage: ${items.join("; ")}.${stalled}`);
  } else {
    lines.push("Open deals: none.");
  }

  if (situation.followUpsTotal) {
    const items = situation.followUps.map(
      (f) =>
        `${quoted(f.name)} ${f.dueAt < situation.todayStart ? "overdue" : formatTime(f.dueAt, settings)}`,
    );
    lines.push(
      `Contacts to follow up today or overdue: ${items.join("; ")}${more(items.length, situation.followUpsTotal)}.`,
    );
  }

  if (situation.events.length) {
    const items = situation.events.map(
      (e) => `${e.allDay ? "all day" : formatTime(e.startsAt, settings)} ${quoted(e.title)}`,
    );
    lines.push(`Today's calendar: ${items.join("; ")}.`);
  } else {
    lines.push("Today's calendar: empty.");
  }

  const { hours, minutes } = splitDuration(situation.prospectingSeconds);
  lines.push(`Calling time today: ${hours} h ${minutes} min.`);

  const { income, expense } = situation.finance;
  lines.push(
    `This month: income ${money(income)}, expenses ${money(expense)}, balance ${money(income - expense)}.`,
  );

  return lines.join("\n");
}

/** Most pressing first; three chips at most, so the panel stays calm. */
export function suggestionsFor(situation: UserSituation, limit = 3): SuggestionKey[] {
  const keys: SuggestionKey[] = [];
  if (situation.followUpsTotal) keys.push("followUps");
  if (situation.overdueTotal) keys.push("overdueTasks");
  if (situation.stalledDeals) keys.push("stalledDeals");
  if (situation.events.length) keys.push("planDay");
  if (!situation.milestonesTotal) keys.push("firstMilestone");
  else keys.push("nextMilestoneStep");
  if (!situation.stages.some((stage) => stage.open > 0)) keys.push("firstDeal");
  if (situation.prospectingSeconds === 0) keys.push("startCalling");
  keys.push("monthFinance");
  if (!keys.includes("planDay")) keys.push("planDay");
  return keys.slice(0, limit);
}
