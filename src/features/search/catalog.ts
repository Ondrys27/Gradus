import {
  BellRingIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  Clock3Icon,
  CoinsIcon,
  FlagIcon,
  GlobeIcon,
  HashIcon,
  LanguagesIcon,
  PlayIcon,
  PlugIcon,
  SparklesIcon,
  SquareKanbanIcon,
  TableIcon,
  UserPlusIcon,
  UserRoundIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react";
import type { NavKey } from "@/components/layout/nav-items";

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
 * Places in Settings and the account. A settings entry points at its control
 * (`focus` is the element id), so "currency settings" lands on the currency picker.
 */
export const SETTINGS_ENTRIES = [
  { id: "language", href: "/app/nastaveni?focus=settings-language", icon: LanguagesIcon },
  { id: "country", href: "/app/nastaveni?focus=settings-country", icon: GlobeIcon },
  { id: "timeZone", href: "/app/nastaveni?focus=settings-timezone", icon: Clock3Icon },
  { id: "currency", href: "/app/nastaveni?focus=settings-currency", icon: CoinsIcon },
  { id: "dateFormat", href: "/app/nastaveni?focus=settings-date", icon: CalendarClockIcon },
  { id: "timeFormat", href: "/app/nastaveni?focus=settings-time", icon: Clock3Icon },
  { id: "numberFormat", href: "/app/nastaveni?focus=settings-number", icon: HashIcon },
  { id: "firstDayOfWeek", href: "/app/nastaveni?focus=settings-week", icon: CalendarClockIcon },
  { id: "sound", href: "/app/nastaveni?focus=settings-sound", icon: Volume2Icon },
  { id: "animations", href: "/app/nastaveni?focus=settings-animations", icon: BellRingIcon },
  {
    id: "integrations",
    href: "/app/nastaveni?focus=settings-integrations",
    icon: PlugIcon,
    ownerOnly: true,
  },
  { id: "profile", href: "/app/profil", icon: UserRoundIcon, group: "account" },
  {
    id: "contactTables",
    href: "/app/kontakty/tabulky",
    icon: TableIcon,
    ownerOnly: true,
    group: "contacts",
  },
] as const satisfies readonly {
  id: string;
  href: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
  group?: "account" | "contacts";
}[];

export type SettingsEntryId = (typeof SETTINGS_ENTRIES)[number]["id"];
