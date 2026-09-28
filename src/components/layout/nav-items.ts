import {
  CalendarDaysIcon,
  CoinsIcon,
  ContactRoundIcon,
  ListChecksIcon,
  LayoutDashboardIcon,
  MilestoneIcon,
  PhoneCallIcon,
  SquareKanbanIcon,
  UsersRoundIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "milestones"
  | "contacts"
  | "pipeline"
  | "coldCalling"
  | "calendar"
  | "finance"
  | "workers"
  | "myTasks"
  | "myRewards";

export type NavItem = { key: NavKey; href: string; icon: LucideIcon };

export const navItems: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { key: "milestones", href: "/milestones", icon: MilestoneIcon },
  { key: "contacts", href: "/contacts", icon: ContactRoundIcon },
  { key: "pipeline", href: "/pipeline", icon: SquareKanbanIcon },
  { key: "coldCalling", href: "/cold-calling", icon: PhoneCallIcon },
  { key: "calendar", href: "/calendar", icon: CalendarDaysIcon },
  { key: "finance", href: "/finance", icon: WalletIcon },
  { key: "workers", href: "/workers", icon: UsersRoundIcon },
];

/** Sections that get their own slot in the phone bottom bar; the rest live under "More". */
export const bottomNavKeys: NavKey[] = ["dashboard", "milestones", "pipeline", "calendar"];

/** Only a worker has these: the tasks their owner gave them and what they earned. */
export const workerOnlyItems: NavItem[] = [
  { key: "myTasks", href: "/tasks", icon: ListChecksIcon },
  { key: "myRewards", href: "/rewards", icon: CoinsIcon },
];

/** Sections an owner can open to a worker, with the app_section each one is stored as. */
export const PERMISSION_SECTIONS = [
  { key: "milestones", section: "milestones" },
  { key: "contacts", section: "contacts" },
  { key: "pipeline", section: "pipeline" },
  { key: "coldCalling", section: "cold_calling" },
  { key: "finance", section: "finance" },
] as const satisfies readonly { key: NavKey; section: string }[];

export type PermissionSection = (typeof PERMISSION_SECTIONS)[number]["section"];

/** What the signed-in worker may open; null for an owner's own account. */
export type WorkerNavAccess = {
  permissions: Partial<Record<string, { view: boolean; edit: boolean }>>;
} | null;

const WORKER_BASE: NavKey[] = ["dashboard", "myTasks", "myRewards", "calendar"];

/**
 * The sidebar of an account. An owner gets the eight sections; a worker gets
 * Dashboard, Tasks, Rewards and Calendar, then every section the owner lets
 * them see.
 */
export function navItemsFor(access: WorkerNavAccess): NavItem[] {
  if (!access) return navItems;
  const byKey = new Map([...navItems, ...workerOnlyItems].map((item) => [item.key, item]));
  const allowed = PERMISSION_SECTIONS.filter(({ section }) => access.permissions[section]?.view).map(
    ({ key }) => key,
  );
  return [...WORKER_BASE, ...allowed].map((key) => byKey.get(key)!);
}

export function bottomNavKeysFor(access: WorkerNavAccess): NavKey[] {
  return access ? WORKER_BASE : bottomNavKeys;
}

/**
 * Whether a page belongs to the account's sidebar. Pages outside every section
 * (profile, settings) are always open; a section that is not in the sidebar is not.
 */
export function isPathAllowed(pathname: string, access: WorkerNavAccess): boolean {
  const all = [...navItems, ...workerOnlyItems];
  const section = all.find((item) => isActivePath(pathname, item.href));
  if (!section) return true;
  return navItemsFor(access).some((item) => item.key === section.key);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
