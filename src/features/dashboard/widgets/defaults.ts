import type { IndustryKey } from "@/features/onboarding/industries";
import type { WidgetKey } from "./catalog";
import { withPositions, type LayoutItem, type WidgetSize } from "./grid";

/**
 * The dashboard an account starts with when nobody set one (28.5): by role,
 * by game or tool mode and by the industry from onboarding. Widgets the
 * account may not use drop out when the board is shown (access.ts), so one
 * list serves everyone of a role. Ids are fixed: the same default is the same
 * layout every time it is computed.
 */

type Entry = readonly [WidgetKey, WidgetSize];

function build(entries: readonly Entry[]): LayoutItem[] {
  return withPositions(
    entries.map(([widget, size], index) => ({
      id: `d${index + 1}`,
      widget,
      size,
      x: 0,
      y: 0,
      settings: {},
    })),
  );
}

export type DefaultFor = {
  role: "owner" | "worker";
  playing: boolean;
  industry: IndustryKey;
};

/** Industries that find clients by phone get the calling widget; a shop its money instead. */
const CALLS: readonly IndustryKey[] = ["realEstate", "trades", "agency", "freelanceIt", "other"];

export function systemDefault({ role, playing, industry }: DefaultFor): LayoutItem[] {
  if (role === "worker") {
    return build([
      ["today", "L"],
      ["overdueTasks", "M"],
      ["workTimer", "M"],
      ["rewards", "M"],
      ["meetings", "M"],
      ["onFire", "XL"],
      ["pipeline", "M"],
      ["quickActions", "M"],
    ]);
  }
  const entries: Entry[] = [
    ["today", "L"],
    ["waiting", "M"],
  ];
  if (playing) entries.push(["level", "S"]);
  entries.push(["tasksDone", "S"]);
  if (!playing) entries.push(["overdueTasks", "S"]);
  if (industry === "coaching") entries.push(["bookings", "M"]);
  entries.push(["onFire", "XL"], ["pipeline", "M"], ["financeMonth", "S"], ["winRate", "S"]);
  entries.push(["milestones", "M"]);
  if (CALLS.includes(industry)) entries.push(["coldCalling", "S"]);
  entries.push(["newContacts", "S"]);
  if (industry === "ecommerce") entries.push(["capital", "L"]);
  entries.push(["grady", "M"], ["quickActions", "M"]);
  return build(entries);
}
