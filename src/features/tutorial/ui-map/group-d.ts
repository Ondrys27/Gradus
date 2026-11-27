import { ADMIN_PATH } from "@/features/admin/access";
import type { SectionGuideDef, UiElement } from "./types";

/**
 * Grady, Settings, connected apps and the administration (30.8): the
 * controls the guide points at. Grady's panel opens from his button on any
 * page (path "" = wherever the user is). Settings the menu shows only to
 * the owner of the space (subscription, the game, Grady's own messages,
 * the company's name and logo; groups.ts `owner` / `notWorker`) need the
 * owner; the administration's controls need the power the page checks
 * before it shows them (roles.ts).
 */

const ANYWHERE = "";
const GRADY = "/app/nastaveni/grady";
const SETTINGS = "/app/nastaveni";
const ACCOUNT = "/app/nastaveni/ucet";
const SUBSCRIPTION = "/app/nastaveni/predplatne";
const APPEARANCE = "/app/nastaveni/vzhled";
const WORK = "/app/nastaveni/prace";
const CALENDAR = "/app/nastaveni/kalendar";
const PRIVACY = "/app/nastaveni/soukromi";
const APPS = "/app/nastaveni/integrace";
const COMPANY = "/app/firma";

const ADMIN = ADMIN_PATH;
const GROWTH = `${ADMIN_PATH}/rust`;
const ACTIVATION = `${ADMIN_PATH}/aktivace`;
const RETENTION = `${ADMIN_PATH}/retence`;
const USERS = `${ADMIN_PATH}/uzivatele`;
const FEEDBACK = `${ADMIN_PATH}/zpetna-vazba`;
const FEATURES = `${ADMIN_PATH}/funkce`;
const EXPLORER = `${ADMIN_PATH}/pruzkumnik`;
const AI = `${ADMIN_PATH}/ai`;
const COSTS = `${ADMIN_PATH}/naklady`;
const HEALTH = `${ADMIN_PATH}/zdravi`;
const ERRORS = `${ADMIN_PATH}/chyby`;
const PLANS = `${ADMIN_PATH}/tarify`;
const PROMO = `${ADMIN_PATH}/promo-kody`;
const NOTIFICATIONS = `${ADMIN_PATH}/upozorneni`;

const owner = { owner: true } as const;
const panel = ["grady-button"] as const;
const appRow = ["apps-app-row"] as const;
const userRow = ["admin-users-row"] as const;

export const GROUP_D_ELEMENTS: readonly UiElement[] = [
  // Grady: his panel (from any page) and Settings → Grady
  { key: "grady-button", section: "grady", path: ANYWHERE, safe: true },
  { key: "grady-messages", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-chips", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-input", section: "grady", path: ANYWHERE, via: panel, input: true },
  { key: "grady-attach", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-send", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-save-note", section: "grady", path: ANYWHERE, via: panel, safe: true },
  {
    key: "grady-saved-open",
    section: "grady",
    path: ANYWHERE,
    via: ["grady-button", "grady-save-note"],
    safe: true,
  },
  { key: "grady-noticed", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-new-chat", section: "grady", path: ANYWHERE, via: panel },
  { key: "grady-tutorial", section: "grady", path: ANYWHERE, via: panel, safe: true },
  { key: "grady-report", section: "grady", path: ANYWHERE, via: panel, safe: true },
  { key: "grady-close", section: "grady", path: ANYWHERE, via: panel, safe: true },
  { key: "grady-proactive", section: "grady", path: GRADY, needs: [owner] },
  { key: "grady-frequency", section: "grady", path: GRADY, needs: [owner] },
  { key: "grady-quiet", section: "grady", path: GRADY, needs: [owner] },
  { key: "grady-demo-delete", section: "grady", path: GRADY, needs: [owner] },
  { key: "grady-start-tutorial", section: "grady", path: GRADY, safe: true },
  { key: "settings-chat-email", section: "grady", path: GRADY },
  { key: "settings-chat-sound", section: "grady", path: GRADY },

  // Settings: the menu of its groups and the search
  { key: "settings-nav-", section: "settings", path: SETTINGS, prefix: true },
  { key: "settings-search", section: "settings", path: SETTINGS, safe: true, input: true },
  // Account
  { key: "settings-avatar", section: "settings", path: ACCOUNT },
  { key: "settings-public-id", section: "settings", path: ACCOUNT },
  { key: "settings-company-name", section: "settings", path: ACCOUNT, needs: [owner], input: true },
  { key: "settings-company-logo", section: "settings", path: ACCOUNT, needs: [owner] },
  { key: "settings-language", section: "settings", path: ACCOUNT },
  { key: "settings-password", section: "settings", path: ACCOUNT },
  { key: "settings-sign-out", section: "settings", path: ACCOUNT },
  // Subscription (the owner's)
  { key: "settings-plan-card", section: "settings", path: SUBSCRIPTION, needs: [owner] },
  {
    key: "settings-change-plan",
    section: "settings",
    path: SUBSCRIPTION,
    needs: [owner],
    safe: true,
  },
  {
    key: "settings-cancel-plan",
    section: "settings",
    path: SUBSCRIPTION,
    needs: [owner],
    safe: true,
  },
  { key: "settings-promo", section: "settings", path: SUBSCRIPTION, needs: [owner] },
  { key: "settings-payments", section: "settings", path: SUBSCRIPTION, needs: [owner] },
  { key: "settings-billing", section: "settings", path: SUBSCRIPTION, needs: [owner] },
  // Appearance and formats
  { key: "appearance-themes", section: "settings", path: APPEARANCE },
  { key: "appearance-create-theme", section: "settings", path: APPEARANCE, safe: true },
  { key: "appearance-schedule", section: "settings", path: APPEARANCE },
  { key: "appearance-sound", section: "settings", path: APPEARANCE },
  // The person's own menu (30.9): pins, hidden sections and order
  { key: "settings-menu", section: "settings", path: APPEARANCE },
  { key: "appearance-animations", section: "settings", path: APPEARANCE },
  { key: "appearance-timezone", section: "settings", path: APPEARANCE },
  { key: "appearance-currency", section: "settings", path: APPEARANCE },
  { key: "appearance-date-format", section: "settings", path: APPEARANCE },
  // Work
  { key: "settings-game-mode", section: "settings", path: WORK, needs: [owner] },
  { key: "settings-path", section: "settings", path: WORK, needs: [owner] },
  { key: "settings-reengage", section: "settings", path: WORK, needs: [owner] },
  {
    key: "settings-cold-calling-stage",
    section: "settings",
    path: WORK,
    needs: [{ right: ["pipeline", "create"] }, { right: ["cold_calling", "view"] }],
  },
  // Calendar
  { key: "settings-calendar-add", section: "settings", path: CALENDAR, input: true },
  { key: "settings-calendar-feed", section: "settings", path: CALENDAR },
  // Privacy and data
  { key: "settings-show-online", section: "settings", path: PRIVACY },
  { key: "settings-export", section: "settings", path: PRIVACY },
  { key: "settings-delete-account", section: "settings", path: PRIVACY },

  // Connected apps
  { key: "apps-server-address", section: "connectedApps", path: APPS },
  { key: "apps-copy-address", section: "connectedApps", path: APPS, safe: true },
  { key: "apps-connect-steps", section: "connectedApps", path: APPS },
  { key: "apps-list", section: "connectedApps", path: APPS },
  { key: "apps-app-row", section: "connectedApps", path: APPS, safe: true },
  { key: "apps-level", section: "connectedApps", path: APPS, via: appRow },
  { key: "apps-history", section: "connectedApps", path: APPS, via: appRow },
  { key: "apps-disconnect", section: "connectedApps", path: APPS, via: appRow },
  { key: "apps-trash", section: "connectedApps", path: APPS },
  { key: "apps-company-mcp", section: "connectedApps", path: COMPANY, needs: [owner] },

  // Administration: the menu, the board and the shared controls (overview)
  { key: "admin-nav-", section: "adminOverview", path: ADMIN, prefix: true },
  { key: "admin-switcher-hint", section: "adminOverview", path: ADMIN },
  { key: "admin-sidebar-collapse", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-board-tabs", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-board-new-tab", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-board-rename-tab", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-board-delete-tab", section: "adminOverview", path: ADMIN },
  {
    key: "admin-set-default",
    section: "adminOverview",
    path: ADMIN,
    needs: [{ power: "setDashboardDefault" }],
    safe: true,
  },
  { key: "admin-period", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-compare", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-internal", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-filters", section: "adminOverview", path: ADMIN, safe: true },
  { key: "admin-refresh", section: "adminOverview", path: ADMIN, safe: true },

  // Administration: people (growth, activation, retention, users, feedback)
  { key: "admin-figures", section: "adminPeople", path: GROWTH },
  { key: "admin-chart", section: "adminPeople", path: GROWTH },
  { key: "admin-table", section: "adminPeople", path: GROWTH },
  { key: "admin-table-export", section: "adminPeople", path: GROWTH },
  { key: "admin-funnel", section: "adminPeople", path: ACTIVATION },
  { key: "admin-cohorts", section: "adminPeople", path: RETENTION },
  { key: "admin-users-search", section: "adminPeople", path: USERS, safe: true, input: true },
  {
    key: "admin-users-export",
    section: "adminPeople",
    path: USERS,
    needs: [{ power: "exportPersonalData" }],
  },
  { key: "admin-users-row", section: "adminPeople", path: USERS, safe: true },
  { key: "admin-user-account", section: "adminPeople", path: USERS, via: userRow },
  { key: "admin-user-actions", section: "adminPeople", path: USERS, via: userRow },
  { key: "admin-user-internal", section: "adminPeople", path: USERS, via: userRow },
  {
    key: "admin-user-subscription",
    section: "adminPeople",
    path: USERS,
    via: userRow,
    needs: [{ power: "editSubscriptions" }],
  },
  {
    key: "admin-user-ai-cap",
    section: "adminPeople",
    path: USERS,
    via: userRow,
    needs: [{ power: "editAiCaps" }],
  },
  { key: "admin-feedback-tabs", section: "adminPeople", path: FEEDBACK, safe: true },
  { key: "admin-feedback-filters", section: "adminPeople", path: FEEDBACK, safe: true },

  // Administration: product (features, explorer, AI and Grady)
  { key: "admin-features-tabs", section: "adminProduct", path: FEATURES, safe: true },
  { key: "admin-explorer-controls", section: "adminProduct", path: EXPLORER },
  { key: "admin-ai-tabs", section: "adminProduct", path: AI, safe: true },
  { key: "admin-ai-budget", section: "adminProduct", path: AI },
  { key: "admin-ai-caps", section: "adminProduct", path: AI },
  { key: "admin-ai-models", section: "adminProduct", path: `${AI}?tab=models` },
  { key: "admin-ai-rules", section: "adminProduct", path: `${AI}?tab=rules` },

  // Administration: operations (costs, health, errors)
  { key: "admin-costs-margin", section: "adminOperations", path: COSTS },
  { key: "admin-costs-payments", section: "adminOperations", path: COSTS },
  { key: "admin-health-cron", section: "adminOperations", path: HEALTH },
  { key: "admin-errors-tabs", section: "adminOperations", path: ERRORS, safe: true },
  { key: "admin-errors-search", section: "adminOperations", path: ERRORS, safe: true, input: true },
  { key: "admin-errors-list", section: "adminOperations", path: ERRORS },

  // Administration: settings (plans, promo codes, notifications)
  {
    key: "admin-plans-editor",
    section: "adminSettings",
    path: PLANS,
    needs: [{ power: "editPlans" }],
  },
  { key: "admin-plans-history", section: "adminSettings", path: PLANS },
  { key: "admin-promo-new", section: "adminSettings", path: PROMO, safe: true },
  { key: "admin-promo-list", section: "adminSettings", path: PROMO },
  { key: "admin-digest-prefs", section: "adminSettings", path: NOTIFICATIONS },
];

export const GROUP_D_GUIDES: readonly SectionGuideDef[] = [
  {
    section: "grady",
    quick: [
      "grady-button",
      "grady-proactive",
      "grady-frequency",
      "grady-quiet",
      "settings-chat-email",
      "grady-start-tutorial",
    ],
    full: [
      { el: "grady-button", act: "do" },
      { el: "grady-proactive" },
      { el: "grady-frequency" },
      { el: "grady-quiet" },
      { el: "settings-chat-email" },
      { el: "settings-chat-sound" },
      { el: "grady-start-tutorial" },
      { el: "grady-demo-delete" },
      { el: "grady-messages" },
      { el: "grady-chips" },
      { el: "grady-input", act: "do" },
      { el: "grady-attach" },
      { el: "grady-send" },
      { el: "grady-save-note" },
      { el: "grady-saved-open" },
      { el: "grady-noticed" },
      { el: "grady-new-chat" },
      { el: "grady-tutorial" },
      { el: "grady-report" },
      { el: "grady-close" },
    ],
  },
  {
    section: "settings",
    quick: [
      "settings-search",
      "settings-avatar",
      "settings-language",
      "settings-plan-card",
      "appearance-themes",
      "appearance-timezone",
      "settings-export",
    ],
    full: [
      { el: "settings-search", act: "do" },
      { el: "settings-avatar" },
      { el: "settings-public-id" },
      { el: "settings-company-name", act: "do" },
      { el: "settings-company-logo" },
      { el: "settings-language" },
      { el: "settings-password" },
      { el: "settings-sign-out" },
      { el: "settings-plan-card" },
      { el: "settings-change-plan" },
      { el: "settings-cancel-plan" },
      { el: "settings-promo" },
      { el: "settings-payments" },
      { el: "settings-billing" },
      { el: "appearance-themes" },
      { el: "appearance-create-theme" },
      { el: "appearance-schedule" },
      { el: "appearance-sound" },
      { el: "appearance-animations" },
      { el: "settings-menu" },
      { el: "appearance-timezone" },
      { el: "appearance-currency" },
      { el: "appearance-date-format" },
      { el: "settings-game-mode" },
      { el: "settings-path" },
      { el: "settings-reengage" },
      { el: "settings-cold-calling-stage" },
      { el: "settings-calendar-add" },
      { el: "settings-calendar-feed" },
      { el: "settings-show-online" },
      { el: "settings-export" },
      { el: "settings-delete-account" },
    ],
  },
  {
    section: "connectedApps",
    quick: [
      "apps-server-address",
      "apps-copy-address",
      "apps-connect-steps",
      "apps-list",
      "apps-trash",
    ],
    full: [
      { el: "apps-server-address" },
      { el: "apps-copy-address", act: "do" },
      { el: "apps-connect-steps" },
      { el: "apps-list" },
      { el: "apps-app-row", act: "do" },
      { el: "apps-level" },
      { el: "apps-history" },
      { el: "apps-disconnect" },
      { el: "apps-trash" },
      { el: "apps-company-mcp" },
    ],
  },
  {
    section: "adminOverview",
    quick: [
      "admin-board-tabs",
      "admin-period",
      "admin-compare",
      "admin-filters",
      "admin-internal",
      "admin-switcher-hint",
    ],
    full: [
      { el: "admin-switcher-hint" },
      { el: "admin-sidebar-collapse" },
      { el: "admin-board-tabs", act: "do" },
      { el: "admin-board-new-tab" },
      { el: "admin-board-rename-tab" },
      { el: "admin-board-delete-tab" },
      { el: "admin-set-default" },
      { el: "admin-period", act: "do" },
      { el: "admin-compare", act: "do" },
      { el: "admin-internal" },
      { el: "admin-filters" },
      { el: "admin-refresh" },
    ],
  },
  {
    section: "adminPeople",
    quick: [
      "admin-figures",
      "admin-chart",
      "admin-funnel",
      "admin-cohorts",
      "admin-users-search",
      "admin-users-row",
      "admin-feedback-tabs",
    ],
    full: [
      { el: "admin-figures" },
      { el: "admin-chart" },
      { el: "admin-table" },
      { el: "admin-table-export" },
      { el: "admin-funnel" },
      { el: "admin-cohorts" },
      { el: "admin-users-search", act: "do" },
      { el: "admin-users-export" },
      { el: "admin-users-row", act: "do" },
      { el: "admin-user-account" },
      { el: "admin-user-actions" },
      { el: "admin-user-internal" },
      { el: "admin-user-subscription" },
      { el: "admin-user-ai-cap" },
      { el: "admin-feedback-tabs", act: "do" },
      { el: "admin-feedback-filters" },
    ],
  },
  {
    section: "adminProduct",
    quick: [
      "admin-features-tabs",
      "admin-explorer-controls",
      "admin-ai-tabs",
      "admin-ai-budget",
      "admin-ai-caps",
    ],
    full: [
      { el: "admin-features-tabs", act: "do" },
      { el: "admin-explorer-controls" },
      { el: "admin-ai-tabs", act: "do" },
      { el: "admin-ai-budget" },
      { el: "admin-ai-caps" },
      { el: "admin-ai-models" },
      { el: "admin-ai-rules" },
    ],
  },
  {
    section: "adminOperations",
    quick: [
      "admin-costs-margin",
      "admin-costs-payments",
      "admin-health-cron",
      "admin-errors-tabs",
      "admin-errors-search",
      "admin-errors-list",
    ],
    full: [
      { el: "admin-costs-margin" },
      { el: "admin-costs-payments" },
      { el: "admin-health-cron" },
      { el: "admin-errors-tabs", act: "do" },
      { el: "admin-errors-search", act: "do" },
      { el: "admin-errors-list" },
    ],
  },
  {
    section: "adminSettings",
    quick: [
      "admin-plans-editor",
      "admin-plans-history",
      "admin-promo-new",
      "admin-promo-list",
      "admin-digest-prefs",
    ],
    full: [
      { el: "admin-plans-editor" },
      { el: "admin-plans-history" },
      { el: "admin-promo-new", act: "do" },
      { el: "admin-promo-list" },
      { el: "admin-digest-prefs" },
    ],
  },
];
