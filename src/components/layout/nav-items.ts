import {
  CalendarDaysIcon,
  ContactRoundIcon,
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
  | "workers";

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

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
