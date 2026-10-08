import { ADMIN_PATH } from "./access";

/** The sections of the administration in sidebar order. */
export const ADMIN_SECTIONS = [
  { key: "overview", href: ADMIN_PATH, ready: true },
  { key: "growth", href: `${ADMIN_PATH}/rust`, ready: true },
  { key: "activation", href: `${ADMIN_PATH}/aktivace`, ready: true },
  { key: "retention", href: `${ADMIN_PATH}/retence`, ready: true },
  { key: "features", href: `${ADMIN_PATH}/funkce`, ready: true },
  { key: "ai", href: `${ADMIN_PATH}/ai`, ready: true },
  { key: "game", href: `${ADMIN_PATH}/hra`, ready: true },
  { key: "costs", href: `${ADMIN_PATH}/naklady`, ready: true },
  { key: "health", href: `${ADMIN_PATH}/zdravi`, ready: true },
  { key: "feedback", href: `${ADMIN_PATH}/zpetna-vazba`, ready: true },
  { key: "users", href: `${ADMIN_PATH}/uzivatele`, ready: true },
  { key: "explorer", href: `${ADMIN_PATH}/pruzkumnik`, ready: true },
  { key: "audit", href: `${ADMIN_PATH}/audit`, ready: true },
] as const;

export type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]["key"];

/** Whether a section's link is the current page. */
export function isActiveSection(href: string, pathname: string): boolean {
  if (href === ADMIN_PATH) return pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pages whose numbers follow the shared controls. The audit keeps its own
 * paging, so the controls are hidden there.
 */
export function usesControls(pathname: string): boolean {
  return !isActiveSection(`${ADMIN_PATH}/audit`, pathname);
}
