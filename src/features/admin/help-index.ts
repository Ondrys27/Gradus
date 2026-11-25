import { ADMIN_PATH } from "./access";
import { sectionsFor, type AdminSectionKey } from "./nav";
import { adminCan, type AdminActor, type AdminPower } from "./roles";

/**
 * What is where in the administration (step 27.2), the one source of the
 * Help page and of the settings and actions ⌘K finds. Every section of the
 * menu (nav.ts) has an entry (a Vitest checks it): one or two sentences in
 * `admin.help.sections.<section>` and the things set or found there, each
 * with `admin.help.items.<item>.title` and `.keywords` (words people search
 * with, both languages' own). An item may point to an element of its page
 * (`anchor` = the element's id), which the page scrolls to and highlights.
 * An item that changes something only some may change names that power; it
 * is left out for the others, as the control itself is.
 */

export type HelpItem = {
  key: string;
  /** The page, with its tab when it has one; the shared view is added when opening it. */
  href: string;
  /** The id of the element on that page. */
  anchor?: string;
  /** Shown only to those who may do it. */
  power?: AdminPower;
};

const P = ADMIN_PATH;
const USERS = `${P}/uzivatele`;
const AI = `${P}/ai`;
const RULES = `${P}/ai?tab=rules`;
const MODELS = `${P}/ai?tab=models`;
const ERRORS = `${P}/chyby`;
const ALERTS = `${P}/chyby?tab=alerts`;
const PLANS = `${P}/tarify`;
const PROMO = `${P}/promo-kody`;
const ADMINS = `${P}/administratori`;

export const ADMIN_HELP: Record<AdminSectionKey, readonly HelpItem[]> = {
  // The overview is a board of widgets (29.2): ⌘K opens a widget's detail (`?widget=`).
  overview: [
    { key: "overviewNumbers", href: P },
    { key: "overviewTabs", href: P },
    { key: "overviewErrors", href: `${P}?widget=errors` },
    { key: "overviewMoney", href: `${P}?widget=revenue`, power: "viewMoney" },
    { key: "overviewAi", href: `${P}?widget=aiSpend` },
    { key: "overviewDefault", href: P, power: "setDashboardDefault" },
    { key: "overviewWarnings", href: P },
  ],
  growth: [{ key: "growthSignups", href: `${P}/rust` }],
  activation: [{ key: "activationFunnel", href: `${P}/aktivace` }],
  retention: [{ key: "retentionCohorts", href: `${P}/retence` }],
  users: [
    { key: "usersSearch", href: USERS, anchor: "users-search" },
    { key: "passwordReset", href: USERS, anchor: "users-search" },
    { key: "confirmationResend", href: USERS, anchor: "users-search" },
    { key: "signOutEverywhere", href: USERS, anchor: "users-search" },
    { key: "emailChange", href: USERS, anchor: "users-search", power: "changeEmails" },
    { key: "userSubscription", href: USERS, anchor: "users-search" },
    { key: "userAiCap", href: USERS, anchor: "users-search" },
    { key: "userInternal", href: USERS, anchor: "users-search" },
    { key: "usersExport", href: USERS, anchor: "users-export", power: "exportPersonalData" },
  ],
  feedback: [
    { key: "bugReports", href: `${P}/zpetna-vazba?tab=reports` },
    { key: "featureRequests", href: `${P}/zpetna-vazba` },
    { key: "satisfaction", href: `${P}/zpetna-vazba` },
  ],
  features: [{ key: "featureAdoption", href: `${P}/funkce` }],
  game: [{ key: "gameXp", href: `${P}/hra` }],
  ai: [
    { key: "aiBudget", href: AI, anchor: "ai-budget" },
    { key: "aiCaps", href: AI, anchor: "stropy" },
    { key: "aiTopUsers", href: AI, anchor: "ai-top-users" },
    { key: "aiConnection", href: AI, anchor: "ai-connection", power: "testGrady" },
    { key: "gradyModels", href: MODELS, anchor: "modely" },
    { key: "gradyEconomy", href: MODELS, anchor: "usporny-rezim" },
    { key: "gradySavings", href: MODELS, anchor: "kde-usetrit" },
    { key: "gradyCompare", href: MODELS, anchor: "modely", power: "compareModels" },
    { key: "aiCostPerUser", href: AI, anchor: "ai-cena-uzivatel" },
    { key: "gradyRules", href: RULES, anchor: "pravidla" },
    { key: "gradyInstructions", href: RULES, anchor: "pravidla" },
    { key: "trashRetention", href: RULES, anchor: "kos-nastaveni" },
  ],
  explorer: [{ key: "explorerEvents", href: `${P}/pruzkumnik` }],
  costs: [
    { key: "costsMargin", href: `${P}/naklady` },
    { key: "costsPayments", href: `${P}/naklady` },
  ],
  health: [
    { key: "healthJobs", href: `${P}/zdravi` },
    { key: "healthRates", href: `${P}/zdravi` },
  ],
  errors: [
    { key: "errorLog", href: ERRORS, anchor: "error-log" },
    { key: "errorSearch", href: ERRORS, anchor: "error-search" },
    { key: "errorStatus", href: ERRORS, anchor: "error-log" },
    { key: "errorAlerts", href: ALERTS, anchor: "error-alerts" },
    { key: "errorAlertsTest", href: ALERTS, anchor: "error-alerts", power: "editErrorAlerts" },
    { key: "peerNotices", href: ALERTS, anchor: "peer-notices", power: "peerNotices" },
  ],
  audit: [
    { key: "auditLog", href: `${P}/audit` },
    { key: "auditExport", href: `${P}/audit`, anchor: "audit-export", power: "exportPersonalData" },
  ],
  plans: [
    { key: "plansDraft", href: PLANS, anchor: "plans-editor", power: "editPlans" },
    { key: "plansPublish", href: PLANS, anchor: "plans-editor", power: "editPlans" },
    { key: "plansCurrencies", href: PLANS, anchor: "plans-editor", power: "editPlans" },
    { key: "plansHistory", href: PLANS, anchor: "plans-history" },
    { key: "plansAccounts", href: PLANS, anchor: "plans-accounts" },
  ],
  promoCodes: [
    { key: "promoCreate", href: PROMO, anchor: "promo-codes" },
    { key: "promoPayouts", href: PROMO, anchor: "promo-codes" },
  ],
  showcase: [{ key: "showcaseMode", href: `${P}/ukazka`, anchor: "ukazkovy-rezim" }],
  integrations: [
    {
      key: "calendarSync",
      href: `${P}/integrace`,
      anchor: "propojeni-kalendaru",
    },
    { key: "calendarSyncAccounts", href: `${P}/integrace`, anchor: "propojeni-ucty", power: "editCalendarSync" },
  ],
  admins: [
    { key: "adminsInvite", href: ADMINS, anchor: "admins-invite", power: "manageAdmins" },
    { key: "adminsLevel", href: ADMINS, anchor: "admins-members", power: "manageAdmins" },
    { key: "adminsRemove", href: ADMINS, anchor: "admins-members", power: "manageAdmins" },
  ],
  help: [{ key: "helpSearch", href: `${P}/napoveda` }],
};

export type HelpSection = { key: AdminSectionKey; href: string; items: HelpItem[] };

/** The sections an actor sees, each with the items they may use, in menu order. */
export function helpFor(actor: AdminActor): HelpSection[] {
  return sectionsFor(actor).map((section) => ({
    key: section.key,
    href: section.href,
    items: ADMIN_HELP[section.key].filter((item) => !item.power || adminCan(actor, item.power)),
  }));
}

/** Lower case, without diacritics and extra spaces: "Strop AI" and "strop ai" are one search. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query is somewhere in the text (both normalized). An empty query matches. */
export function matchesSearch(text: string, query: string): boolean {
  const haystack = normalizeSearch(text);
  return normalizeSearch(query)
    .split(" ")
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Where an item opens: its page with the shared view of the administration
 * (`kept`, "?period=…" or "") and the anchor.
 */
export function helpItemHref(item: Pick<HelpItem, "href" | "anchor">, kept: string): string {
  const extra = kept.replace(/^\?/, "");
  const base = extra ? `${item.href}${item.href.includes("?") ? "&" : "?"}${extra}` : item.href;
  return item.anchor ? `${base}#${item.anchor}` : base;
}

/** The event that asks the page to highlight the element of the address's anchor again. */
export const ADMIN_HIGHLIGHT_EVENT = "gradus:admin-highlight";
