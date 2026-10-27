import { ADMIN_PATH } from "./access";
import { adminCan, type AdminRole } from "./roles";

/**
 * The five groups of the administration, in menu order. The overview stands
 * alone; the others gather the sections by the question they answer: who
 * the people are, how the product is used, whether running it is fine, and
 * who may be here.
 */
export const ADMIN_GROUPS = ["overview", "people", "product", "operations", "settings"] as const;
export type AdminGroupKey = (typeof ADMIN_GROUPS)[number];

/** The sections of the administration in menu order, each in its group. */
export const ADMIN_SECTIONS = [
  { key: "overview", group: "overview", href: ADMIN_PATH, ready: true },
  { key: "growth", group: "people", href: `${ADMIN_PATH}/rust`, ready: true },
  { key: "activation", group: "people", href: `${ADMIN_PATH}/aktivace`, ready: true },
  { key: "retention", group: "people", href: `${ADMIN_PATH}/retence`, ready: true },
  { key: "users", group: "people", href: `${ADMIN_PATH}/uzivatele`, ready: true },
  { key: "feedback", group: "people", href: `${ADMIN_PATH}/zpetna-vazba`, ready: true },
  { key: "features", group: "product", href: `${ADMIN_PATH}/funkce`, ready: true },
  { key: "game", group: "product", href: `${ADMIN_PATH}/hra`, ready: true },
  { key: "ai", group: "product", href: `${ADMIN_PATH}/ai`, ready: true },
  { key: "explorer", group: "product", href: `${ADMIN_PATH}/pruzkumnik`, ready: true },
  { key: "costs", group: "operations", href: `${ADMIN_PATH}/naklady`, ready: true },
  { key: "health", group: "operations", href: `${ADMIN_PATH}/zdravi`, ready: true },
  { key: "audit", group: "operations", href: `${ADMIN_PATH}/audit`, ready: true },
  { key: "plans", group: "settings", href: `${ADMIN_PATH}/tarify`, ready: true },
  { key: "errorAlerts", group: "settings", href: `${ADMIN_PATH}/upozorneni`, ready: true },
  {
    key: "admins",
    group: "settings",
    href: `${ADMIN_PATH}/administratori`,
    ready: true,
    ownerOnly: true,
  },
] as const;

export type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]["key"];
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** The sections a role sees: an admin never sees the owner's (not even greyed out). */
export function sectionsFor(role: AdminRole) {
  return ADMIN_SECTIONS.filter(
    (section) => !("ownerOnly" in section && section.ownerOnly) || adminCan(role, "manageAdmins"),
  );
}

/** The groups a role sees with their sections; a group with nothing to show is left out. */
export function groupsFor(role: AdminRole): { key: AdminGroupKey; sections: AdminSection[] }[] {
  const sections = sectionsFor(role);
  return ADMIN_GROUPS.map((key) => ({
    key,
    sections: sections.filter((section) => section.group === key),
  })).filter((group) => group.sections.length > 0);
}

/** Whether a section's link is the current page. */
export function isActiveSection(href: string, pathname: string): boolean {
  if (href === ADMIN_PATH) return pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group the current page belongs to, for the phone's bottom bar. */
export function activeGroup(pathname: string): AdminGroupKey | null {
  return ADMIN_SECTIONS.find((section) => isActiveSection(section.href, pathname))?.group ?? null;
}
