import type { NavKey } from "@/components/layout/nav-items";
import type { AdminGroupKey } from "@/features/admin/nav";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_SECTIONS, isActiveSection } from "@/features/admin/nav";
import type { AdminGuideSection, AppGuideSection, GuideSection } from "../ui-map/types";

/**
 * Where each guide section lives (30.8): its page, the menu item that leads
 * there (a step "go to the section" lights it) and which page belongs to
 * which section, so the "?" in the header knows whose guide to offer.
 */

export type SectionPlace = {
  /** The page the section opens on. */
  path: string;
  /** What lights up when Grady leads there: a menu item (`nav-…`) or another target. */
  nav: readonly string[];
  /** The sidebar section a worker must have in their menu; null = everybody has it. */
  menu: NavKey | null;
};

export const APP_SECTION_PLACES: Record<AppGuideSection, SectionPlace> = {
  dashboard: { path: "/app", nav: ["nav-dashboard"], menu: "dashboard" },
  milestones: { path: "/app/milniky", nav: ["nav-milestones"], menu: "milestones" },
  notes: { path: "/app/poznamky", nav: ["nav-notes"], menu: "notes" },
  contacts: { path: "/app/kontakty", nav: ["nav-contacts"], menu: "contacts" },
  coldCalling: { path: "/app/cold-calling", nav: ["nav-coldCalling"], menu: "coldCalling" },
  pipeline: { path: "/app/pipeline", nav: ["nav-pipeline"], menu: "pipeline" },
  tasks: { path: "/app/ukoly-crm", nav: ["nav-tasks"], menu: "tasks" },
  calendar: { path: "/app/kalendar", nav: ["nav-calendar"], menu: "calendar" },
  scheduler: { path: "/app/planovac", nav: ["nav-scheduler"], menu: "scheduler" },
  finance: { path: "/app/finance", nav: ["nav-finance"], menu: "finance" },
  invoices: { path: "/app/finance?tab=invoices", nav: ["nav-finance"], menu: "finance" },
  company: { path: "/app/firma", nav: ["nav-workers"], menu: "workers" },
  rewards: { path: "/app/firma?tab=rewards", nav: ["nav-workers", "nav-myRewards"], menu: null },
  messages: { path: "/app/zpravy", nav: ["nav-messages"], menu: "messages" },
  grady: { path: "/app/nastaveni/grady", nav: ["grady"], menu: null },
  settings: { path: "/app/nastaveni", nav: ["account"], menu: null },
  connectedApps: { path: "/app/nastaveni/integrace", nav: ["account"], menu: null },
};

/** The administration's groups and the guide each has. */
export const ADMIN_GUIDE_OF_GROUP: Record<AdminGroupKey, AdminGuideSection> = {
  overview: "adminOverview",
  people: "adminPeople",
  product: "adminProduct",
  operations: "adminOperations",
  settings: "adminSettings",
};

function firstAdminSection(group: AdminGroupKey) {
  return ADMIN_SECTIONS.find((section) => section.group === group)!;
}

export const ADMIN_SECTION_PLACES: Record<AdminGuideSection, SectionPlace> = Object.fromEntries(
  (Object.entries(ADMIN_GUIDE_OF_GROUP) as [AdminGroupKey, AdminGuideSection][]).map(
    ([group, guide]) => {
      const first = firstAdminSection(group);
      return [guide, { path: first.href, nav: [`admin-nav-${first.key}`], menu: null }];
    },
  ),
) as unknown as Record<AdminGuideSection, SectionPlace>;

export function sectionPlace(section: GuideSection): SectionPlace {
  return section in APP_SECTION_PLACES
    ? APP_SECTION_PLACES[section as AppGuideSection]
    : ADMIN_SECTION_PLACES[section as AdminGuideSection];
}

/**
 * The guide section of a page: the longest matching address wins (Settings →
 * Grady is Grady's, Finance with the invoices tab or an invoice is Invoices).
 * Null for pages that belong to none (invites, the showcase).
 */
export function guideSectionOf(pathname: string, search = ""): GuideSection | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`)) {
    const section = ADMIN_SECTIONS.find((entry) => isActiveSection(entry.href, path));
    return section ? ADMIN_GUIDE_OF_GROUP[section.group] : "adminOverview";
  }
  const params = new URLSearchParams(search);
  if (path === "/app") return "dashboard";
  if (path.startsWith("/app/finance/faktury")) return "invoices";
  if (path === "/app/finance" && params.get("tab") === "invoices") return "invoices";
  if (path === "/app/odmeny" || path.startsWith("/app/firma/odmeny")) return "rewards";
  if (path === "/app/firma" && params.get("tab") === "rewards") return "rewards";
  if (path.startsWith("/app/nastaveni/grady")) return "grady";
  if (path.startsWith("/app/nastaveni/integrace")) return "connectedApps";
  const order: AppGuideSection[] = [
    "settings",
    "milestones",
    "notes",
    "contacts",
    "coldCalling",
    "pipeline",
    "tasks",
    "calendar",
    "scheduler",
    "finance",
    "company",
    "messages",
  ];
  for (const section of order) {
    const base = APP_SECTION_PLACES[section].path.split("?")[0]!;
    if (path === base || path.startsWith(`${base}/`)) return section;
  }
  // The old sales tasks address redirects to the new one.
  if (path.startsWith("/app/ukoly")) return "tasks";
  return null;
}

/**
 * Whether an address is the page of a step: the same path (or a page under
 * it, a detail) and, when the step names a tab, that tab.
 */
export function onPage(path: string, pathname: string, search = ""): boolean {
  const [base, query] = path.split("?");
  const here = pathname.replace(/\/+$/, "") || "/";
  const target = base!.replace(/\/+$/, "") || "/";
  const same =
    target === "/app" || target === ADMIN_PATH ? here === target : here === target || here.startsWith(`${target}/`);
  if (!same) return false;
  if (!query) return true;
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(search);
  for (const [name, value] of want) if (have.get(name) !== value) return false;
  return true;
}
