import {
  CalendarPlusIcon,
  FlagIcon,
  PlayIcon,
  SparklesIcon,
  SquareKanbanIcon,
  TableIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@/components/layout/nav-items";
import { SETTINGS_ITEMS, settingsItemHref, type SettingsItemDef } from "@/features/settings/groups";

/** Quick actions: each opens its section with a one-off request the page carries out. */
export const QUICK_ACTIONS = [
  { id: "newContact", href: "/app/kontakty?new=contact", icon: UserPlusIcon, section: "contacts" },
  { id: "newDeal", href: "/app/pipeline?new=deal", icon: SquareKanbanIcon, section: "pipeline" },
  { id: "newMilestone", href: "/app/milniky?new=milestone", icon: FlagIcon, section: "milestones" },
  { id: "newEvent", href: "/app/kalendar?new=event", icon: CalendarPlusIcon, section: "calendar" },
  { id: "startTimer", href: "/app/cold-calling?timer=start", icon: PlayIcon, section: "coldCalling" },
  {
    id: "generateContacts",
    href: "/app/kontakty?new=generate",
    icon: SparklesIcon,
    section: "contacts",
  },
] as const satisfies readonly { id: string; href: string; icon: LucideIcon; section: NavKey }[];

export type QuickActionId = (typeof QUICK_ACTIONS)[number]["id"];

/**
 * Places in Settings and the account. The settings themselves come from the
 * settings catalog (one entry there is enough); each points at its control, so
 * "currency settings" lands on the currency picker and lights it up.
 */
export const SETTINGS_ENTRIES = [
  ...SETTINGS_ITEMS.map((item) => ({ id: item.id, item, href: settingsItemHref(item) })),
  {
    id: "contactTables",
    href: "/app/kontakty/tabulky",
    icon: TableIcon,
    ownerOnly: true,
    group: "contacts",
  },
] as const satisfies readonly (
  | { id: string; href: string; item: SettingsItemDef }
  | { id: string; href: string; icon: LucideIcon; ownerOnly?: boolean; group: "contacts" }
)[];

export type SettingsEntryId = (typeof SETTINGS_ENTRIES)[number]["id"];
