import {
  CreditCardIcon,
  PaletteIcon,
  ShieldIcon,
  SparklesIcon,
  UserRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { PLAN_PATH } from "@/lib/routes";

/** Settings, the hub; every group is a page under it. */
export const SETTINGS_PATH = "/app/nastaveni";

export const SETTINGS_GROUPS = [
  "account",
  "subscription",
  "jarvis",
  "appearance",
  "work",
  "privacy",
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/**
 * Who sees a group or an item. `owner` is the owner of the workspace,
 * `notWorker` any account that is not somebody's worker (the game and
 * Jarvis are the owner's), `caller` whoever may call and make deals.
 */
export type SettingsAudience = "all" | "owner" | "notWorker" | "caller";

export type SettingsGroupDef = {
  key: SettingsGroup;
  href: string;
  icon: LucideIcon;
  who: SettingsAudience;
};

export const SETTINGS_GROUP_DEFS: readonly SettingsGroupDef[] = [
  { key: "account", href: `${SETTINGS_PATH}/ucet`, icon: UserRoundIcon, who: "all" },
  { key: "subscription", href: PLAN_PATH, icon: CreditCardIcon, who: "owner" },
  { key: "jarvis", href: `${SETTINGS_PATH}/jarvis`, icon: SparklesIcon, who: "all" },
  { key: "appearance", href: `${SETTINGS_PATH}/vzhled`, icon: PaletteIcon, who: "all" },
  { key: "work", href: `${SETTINGS_PATH}/prace`, icon: WrenchIcon, who: "all" },
  { key: "privacy", href: `${SETTINGS_PATH}/soukromi`, icon: ShieldIcon, who: "all" },
];

export function settingsGroupDef(group: SettingsGroup): SettingsGroupDef {
  return SETTINGS_GROUP_DEFS.find((def) => def.key === group)!;
}

export function settingsGroupPath(group: SettingsGroup): string {
  return settingsGroupDef(group).href;
}

/** The group of an address under Settings, or null for the hub itself. */
export function settingsGroupOf(pathname: string): SettingsGroup | null {
  const clean = pathname.replace(/\/+$/, "");
  return SETTINGS_GROUP_DEFS.find((def) => def.href === clean)?.key ?? null;
}

export type SettingsItemDef = {
  id: string;
  group: SettingsGroup;
  /** The id of the element the item lands on (`?focus=`). */
  target: string;
  who: SettingsAudience;
};

/**
 * Every setting a person can look for, with where it lives. Labels and
 * keywords are in `settings.items.<id>`; the settings search and ⌘K both
 * read this list, so one entry is enough for a new setting.
 */
export const SETTINGS_ITEMS: readonly SettingsItemDef[] = [
  { id: "avatar", group: "account", target: "settings-avatar", who: "all" },
  { id: "displayName", group: "account", target: "settings-display-name", who: "all" },
  { id: "username", group: "account", target: "settings-username", who: "all" },
  { id: "email", group: "account", target: "settings-email", who: "all" },
  { id: "language", group: "account", target: "settings-language", who: "all" },
  { id: "password", group: "account", target: "settings-password", who: "all" },
  { id: "signOut", group: "account", target: "settings-sign-out", who: "all" },
  { id: "plan", group: "subscription", target: "settings-plan", who: "owner" },
  { id: "promoCode", group: "subscription", target: "settings-promo", who: "owner" },
  { id: "payments", group: "subscription", target: "settings-payments", who: "owner" },
  { id: "billing", group: "subscription", target: "settings-billing", who: "owner" },
  { id: "jarvisProactive", group: "jarvis", target: "settings-jarvis-proactive", who: "notWorker" },
  { id: "jarvisFrequency", group: "jarvis", target: "settings-jarvis-frequency", who: "notWorker" },
  { id: "jarvisQuiet", group: "jarvis", target: "settings-jarvis-quiet", who: "notWorker" },
  { id: "chatEmail", group: "jarvis", target: "settings-chat-email", who: "all" },
  { id: "chatSound", group: "jarvis", target: "settings-chat-sound", who: "all" },
  { id: "tour", group: "jarvis", target: "settings-help-tour", who: "all" },
  { id: "theme", group: "appearance", target: "settings-theme", who: "all" },
  { id: "sound", group: "appearance", target: "settings-sound", who: "all" },
  { id: "animations", group: "appearance", target: "settings-animations", who: "all" },
  { id: "country", group: "appearance", target: "settings-country", who: "all" },
  { id: "timeZone", group: "appearance", target: "settings-timezone", who: "all" },
  { id: "currency", group: "appearance", target: "settings-currency", who: "all" },
  { id: "dateFormat", group: "appearance", target: "settings-date", who: "all" },
  { id: "timeFormat", group: "appearance", target: "settings-time", who: "all" },
  { id: "numberFormat", group: "appearance", target: "settings-number", who: "all" },
  { id: "firstDayOfWeek", group: "appearance", target: "settings-week", who: "all" },
  { id: "gameMode", group: "work", target: "settings-mode", who: "notWorker" },
  { id: "path", group: "work", target: "settings-path", who: "notWorker" },
  { id: "reengage", group: "work", target: "settings-reengage", who: "owner" },
  { id: "coldCallingStage", group: "work", target: "settings-cold-calling-stage", who: "caller" },
  { id: "invoices", group: "work", target: "settings-invoices", who: "owner" },
  { id: "export", group: "privacy", target: "settings-account-export", who: "all" },
  { id: "legal", group: "privacy", target: "settings-legal", who: "all" },
  { id: "deleteAccount", group: "privacy", target: "settings-account-delete", who: "all" },
];

export type SettingsItemId = (typeof SETTINGS_ITEMS)[number]["id"];

/** The address that opens the group and lights the item up. */
export function settingsItemHref(item: SettingsItemDef): string {
  return `${settingsGroupPath(item.group)}?focus=${item.target}`;
}

/** The deep link of one setting by its id, for links from elsewhere in the app. */
export function settingsHref(id: SettingsItemId): string {
  return settingsItemHref(SETTINGS_ITEMS.find((item) => item.id === id)!);
}

export type SettingsViewer = { owner: boolean; worker: boolean; caller: boolean };

export function settingsAudienceAllows(who: SettingsAudience, viewer: SettingsViewer): boolean {
  switch (who) {
    case "all":
      return true;
    case "owner":
      return viewer.owner;
    case "notWorker":
      return !viewer.worker;
    case "caller":
      return viewer.caller;
  }
}

export function visibleSettingsItems(viewer: SettingsViewer): SettingsItemDef[] {
  return SETTINGS_ITEMS.filter((item) => settingsAudienceAllows(item.who, viewer));
}

/** Groups with at least one item the viewer may see, in menu order. */
export function visibleSettingsGroups(viewer: SettingsViewer): SettingsGroupDef[] {
  const items = visibleSettingsItems(viewer);
  return SETTINGS_GROUP_DEFS.filter(
    (def) =>
      settingsAudienceAllows(def.who, viewer) && items.some((item) => item.group === def.key),
  );
}
