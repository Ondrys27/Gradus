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
import { APP_HOME_PATH } from "@/lib/routes";

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
  { key: "dashboard", href: "/app", icon: LayoutDashboardIcon },
  { key: "milestones", href: "/app/milniky", icon: MilestoneIcon },
  { key: "contacts", href: "/app/kontakty", icon: ContactRoundIcon },
  { key: "pipeline", href: "/app/pipeline", icon: SquareKanbanIcon },
  { key: "coldCalling", href: "/app/cold-calling", icon: PhoneCallIcon },
  { key: "calendar", href: "/app/kalendar", icon: CalendarDaysIcon },
  { key: "finance", href: "/app/finance", icon: WalletIcon },
  { key: "workers", href: "/app/pracovnici", icon: UsersRoundIcon },
];

/** Sections that get their own slot in the phone bottom bar; the rest live under "More". */
export const bottomNavKeys: NavKey[] = ["dashboard", "milestones", "pipeline", "calendar"];

/** Only a worker has these: the tasks their owner gave them and what they earned. */
export const workerOnlyItems: NavItem[] = [
  { key: "myTasks", href: "/app/ukoly", icon: ListChecksIcon },
  { key: "myRewards", href: "/app/odmeny", icon: CoinsIcon },
];

/** Sections an owner can open to a worker, with the app_section each one is stored as. */
export const PERMISSION_SECTIONS = [
  { key: "milestones", section: "milestones" },
  { key: "contacts", section: "contacts" },
  { key: "pipeline", section: "pipeline" },
  { key: "coldCalling", section: "cold_calling" },
  { key: "calendar", section: "calendar" },
  { key: "finance", section: "finance" },
] as const satisfies readonly { key: NavKey; section: string }[];

export type PermissionSection = (typeof PERMISSION_SECTIONS)[number]["section"];

/** What the signed-in worker may open; null for an owner's own account. */
export type WorkerNavAccess = {
  permissions: Partial<Record<string, { view: boolean; edit: boolean }>>;
} | null;

const WORKER_BASE: NavKey[] = ["dashboard", "myTasks", "myRewards"];

/**
 * The sidebar of an account. An owner gets the eight sections; a worker gets
 * their own Dashboard, Tasks and Rewards, then every section the owner lets
 * them see. Workers and settings of the owner are never among them.
 */
export function navItemsFor(access: WorkerNavAccess): NavItem[] {
  if (!access) return navItems;
  const byKey = new Map([...navItems, ...workerOnlyItems].map((item) => [item.key, item]));
  const allowed = PERMISSION_SECTIONS.filter(
    ({ section }) => access.permissions[section]?.view,
  ).map(({ key }) => key);
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

/** The dashboard is /app itself, so only its exact address belongs to it. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === APP_HOME_PATH) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
