import type { SectionGuideDef, UiElement } from "./types";

/**
 * Finance, invoices, Company, rewards and messages (30.8): the controls the
 * guide points at. Rights mirror how each component hides the control
 * (canDo / useCan / the owner's role).
 */

const MONTH = "/app/finance?tab=month";
const TRANSACTIONS = "/app/finance?tab=transactions";
const RECURRING = "/app/finance?tab=recurring";
const OVERVIEW = "/app/finance?tab=overview";
const INVOICES = "/app/finance?tab=invoices";
const NEW_INVOICE = "/app/finance/faktury/nova";
// Settings → Work → Invoices (the supplier's details and the look), the owner's.
const INVOICE_SETTINGS = "/app/nastaveni/prace";
const COMPANY = "/app/firma";
const GROUPS = "/app/firma?tab=groups";
const ACTIVITY = "/app/firma?tab=activity";
const DASHBOARDS = "/app/firma?tab=dashboards";
// /app/firma/odmeny only redirects here.
const REWARDS = "/app/firma?tab=rewards";
const MY_REWARDS = "/app/odmeny";
const MESSAGES = "/app/zpravy";

const financeWrite = { right: ["finance", "write"] } as const;
const invoicesView = { right: ["invoices", "view"] } as const;
const invoicesIssue = { right: ["invoices", "issue"] } as const;
const owner = { owner: true } as const;
const companyUpdate = { right: ["company", "update"] } as const;
const manageRewards = { right: ["company", "rewards"] } as const;

/** A person's dashboard opened from the list, then one of its tabs. */
const IN_WORKER_TAB = ["company-person-row", "worker-tabs"] as const;

export const GROUP_C_ELEMENTS: readonly UiElement[] = [
  // Finance
  { key: "finance-tabs", section: "finance", path: MONTH, safe: true },
  { key: "plan-month-nav", section: "finance", path: MONTH, safe: true },
  { key: "plan-views", section: "finance", path: MONTH, safe: true },
  { key: "plan-grid", section: "finance", path: MONTH },
  { key: "plan-summary", section: "finance", path: MONTH },
  { key: "plan-reserve", section: "finance", path: MONTH, needs: [financeWrite], input: true },
  { key: "plan-hide-empty", section: "finance", path: MONTH, safe: true },
  { key: "plan-create-month", section: "finance", path: MONTH, needs: [financeWrite], safe: true },
  { key: "plan-carry", section: "finance", path: MONTH, needs: [financeWrite], safe: true },
  { key: "plan-export", section: "finance", path: MONTH, safe: true },
  { key: "plan-more", section: "finance", path: MONTH, needs: [financeWrite], safe: true },
  { key: "plan-import", section: "finance", path: MONTH, via: ["plan-more"], needs: [financeWrite], safe: true },
  { key: "plan-close", section: "finance", path: MONTH, via: ["plan-more"], needs: [financeWrite] },
  { key: "finance-add", section: "finance", path: TRANSACTIONS, needs: [financeWrite], safe: true },
  { key: "finance-amount", section: "finance", path: TRANSACTIONS, via: ["finance-add"], needs: [financeWrite], input: true },
  { key: "finance-period", section: "finance", path: TRANSACTIONS, safe: true },
  { key: "finance-category-filter", section: "finance", path: TRANSACTIONS, safe: true },
  { key: "finance-transaction-row", section: "finance", path: TRANSACTIONS, safe: true },
  { key: "finance-recurring-add", section: "finance", path: RECURRING, needs: [financeWrite], safe: true },
  { key: "finance-recurring-row", section: "finance", path: RECURRING, safe: true },
  { key: "finance-overview", section: "finance", path: OVERVIEW, needs: [{ right: ["finance", "summaries"] }] },

  // Invoices
  { key: "invoice-new", section: "invoices", path: INVOICES, needs: [invoicesIssue], safe: true },
  { key: "invoice-setup", section: "invoices", path: INVOICES, needs: [owner], safe: true },
  { key: "invoice-search", section: "invoices", path: INVOICES, needs: [invoicesView], safe: true, input: true },
  { key: "invoice-filter", section: "invoices", path: INVOICES, needs: [invoicesView], safe: true },
  { key: "invoice-sort", section: "invoices", path: INVOICES, needs: [invoicesView], safe: true },
  { key: "invoice-row", section: "invoices", path: INVOICES, needs: [invoicesView], safe: true },
  { key: "invoice-customer", section: "invoices", path: NEW_INVOICE, needs: [invoicesIssue], input: true },
  { key: "invoice-add-item", section: "invoices", path: NEW_INVOICE, needs: [invoicesIssue], safe: true },
  { key: "invoice-preview", section: "invoices", path: NEW_INVOICE, needs: [invoicesIssue] },
  { key: "invoice-save-draft", section: "invoices", path: NEW_INVOICE, needs: [invoicesIssue] },
  { key: "invoice-issue", section: "invoices", path: NEW_INVOICE, needs: [invoicesIssue] },
  { key: "invoice-download", section: "invoices", path: INVOICES, via: ["invoice-row"], needs: [invoicesView] },
  { key: "invoice-send", section: "invoices", path: INVOICES, via: ["invoice-row"], needs: [invoicesIssue], safe: true },
  { key: "invoice-mark-paid", section: "invoices", path: INVOICES, via: ["invoice-row"], needs: [invoicesIssue] },
  { key: "invoice-cancel", section: "invoices", path: INVOICES, via: ["invoice-row"], needs: [invoicesIssue] },
  { key: "invoice-settings", section: "invoices", path: INVOICE_SETTINGS, needs: [owner], input: true },
  { key: "invoice-style", section: "invoices", path: INVOICE_SETTINGS, needs: [owner] },

  // Company
  { key: "worker-invite", section: "company", path: COMPANY, needs: [owner], safe: true },
  { key: "worker-invite-existing", section: "company", path: COMPANY, via: ["worker-invite"], needs: [owner], safe: true },
  { key: "worker-invite-new", section: "company", path: COMPANY, via: ["worker-invite"], needs: [owner], safe: true },
  { key: "invite-next", section: "company", path: COMPANY, via: ["worker-invite", "worker-invite-new"], needs: [owner] },
  { key: "worker-submit", section: "company", path: COMPANY, via: ["worker-invite"], needs: [owner] },
  { key: "worker-invite-done", section: "company", path: COMPANY, via: ["worker-invite"], needs: [owner], safe: true },
  { key: "company-tabs", section: "company", path: COMPANY, safe: true },
  { key: "company-group-filter", section: "company", path: COMPANY, safe: true },
  { key: "company-status-filter", section: "company", path: COMPANY, safe: true },
  { key: "company-view-switch", section: "company", path: COMPANY, safe: true },
  { key: "company-person-row", section: "company", path: COMPANY, safe: true },
  { key: "company-row-menu", section: "company", path: COMPANY, needs: [owner], safe: true },
  { key: "company-move", section: "company", path: COMPANY, via: ["company-row-menu"], needs: [owner], safe: true },
  { key: "worker-tabs", section: "company", path: COMPANY, via: ["company-person-row"], safe: true },
  { key: "worker-assign-task", section: "company", path: COMPANY, via: ["company-person-row"], needs: [owner], safe: true },
  { key: "worker-remove", section: "company", path: COMPANY, via: ["company-person-row"], needs: [owner] },
  { key: "worker-dashboard-close", section: "company", path: COMPANY, via: ["company-person-row"], safe: true },
  { key: "worker-rights", section: "company", path: COMPANY, via: IN_WORKER_TAB, needs: [owner] },
  { key: "worker-work", section: "company", path: COMPANY, via: IN_WORKER_TAB },
  { key: "worker-documents-upload", section: "company", path: COMPANY, via: IN_WORKER_TAB, needs: [companyUpdate], safe: true },
  { key: "company-group-add", section: "company", path: GROUPS, needs: [owner], safe: true },
  { key: "company-group-card", section: "company", path: GROUPS, needs: [owner] },
  { key: "company-group-edit", section: "company", path: GROUPS, needs: [owner], safe: true },
  { key: "company-activity", section: "company", path: ACTIVITY },
  { key: "company-dashboards", section: "company", path: DASHBOARDS, needs: [owner] },

  // Rewards (everyone's on Company → Rewards and payouts, one person's on their dashboard → Rewards)
  { key: "reward-tiles", section: "rewards", path: REWARDS, needs: [manageRewards] },
  { key: "reward-team", section: "rewards", path: REWARDS, needs: [manageRewards] },
  { key: "reward-approve", section: "rewards", path: REWARDS, needs: [manageRewards] },
  { key: "reward-pay", section: "rewards", path: REWARDS, needs: [manageRewards], safe: true },
  { key: "reward-export", section: "rewards", path: REWARDS, needs: [manageRewards] },
  { key: "reward-person", section: "rewards", path: REWARDS, needs: [manageRewards], safe: true },
  { key: "reward-add", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards], safe: true },
  { key: "reward-plan", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards] },
  { key: "reward-template", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards], safe: true },
  { key: "reward-rule-add", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards], safe: true },
  { key: "reward-setup", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards], safe: true },
  { key: "reward-work-table", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards] },
  { key: "reward-payouts", section: "rewards", path: REWARDS, via: ["reward-person"], needs: [manageRewards] },
  // A worker's own rewards (the page exists only in someone else's company).
  { key: "reward-mine", section: "rewards", path: MY_REWARDS, needs: [{ worker: true }] },

  // Messages
  { key: "messages-search", section: "messages", path: MESSAGES, safe: true, input: true },
  { key: "messages-list", section: "messages", path: MESSAGES },
  { key: "messages-conversation", section: "messages", path: MESSAGES, safe: true },
  { key: "messages-person", section: "messages", path: MESSAGES, safe: true },
  { key: "messages-pick", section: "messages", path: MESSAGES },
  { key: "messages-input", section: "messages", path: MESSAGES, via: ["messages-conversation"], input: true },
  { key: "messages-attach", section: "messages", path: MESSAGES, via: ["messages-conversation"], safe: true },
  { key: "messages-send", section: "messages", path: MESSAGES, via: ["messages-conversation"] },
  { key: "messages-message-menu", section: "messages", path: MESSAGES, via: ["messages-conversation"], safe: true },
  { key: "messages-reply", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-message-menu"], safe: true },
  { key: "messages-edit", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-message-menu"], safe: true },
  { key: "messages-delete", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-message-menu"] },
  { key: "messages-conversation-menu", section: "messages", path: MESSAGES, via: ["messages-conversation"], safe: true },
  { key: "messages-pin", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-conversation-menu"] },
  { key: "messages-mute", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-conversation-menu"] },
  { key: "messages-mute-all", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-conversation-menu"], needs: [owner] },
  { key: "messages-export", section: "messages", path: MESSAGES, via: ["messages-conversation", "messages-conversation-menu"], needs: [owner] },
];

export const GROUP_C_GUIDES: readonly SectionGuideDef[] = [
  {
    section: "finance",
    quick: ["finance-tabs", "plan-month-nav", "plan-grid", "plan-summary", "plan-views", "finance-transaction-row", "finance-recurring-row"],
    full: [
      { el: "finance-tabs", act: "do" },
      { el: "plan-month-nav" },
      { el: "plan-create-month" },
      { el: "plan-grid", act: "do" },
      { el: "plan-summary" },
      { el: "plan-reserve" },
      { el: "plan-views", act: "do" },
      { el: "plan-hide-empty" },
      { el: "plan-carry" },
      { el: "plan-export" },
      { el: "plan-more" },
      { el: "plan-import" },
      { el: "plan-close" },
      { el: "finance-add", act: "do" },
      { el: "finance-amount" },
      { el: "finance-period" },
      { el: "finance-category-filter" },
      { el: "finance-transaction-row" },
      { el: "finance-recurring-add" },
      { el: "finance-recurring-row" },
      { el: "finance-overview" },
    ],
  },
  {
    section: "invoices",
    quick: ["invoice-new", "invoice-search", "invoice-filter", "invoice-sort", "invoice-row"],
    full: [
      { el: "invoice-setup" },
      { el: "invoice-search", act: "do" },
      { el: "invoice-filter" },
      { el: "invoice-sort" },
      { el: "invoice-row" },
      { el: "invoice-new", act: "do" },
      { el: "invoice-customer", act: "do" },
      { el: "invoice-add-item", act: "do" },
      { el: "invoice-preview" },
      { el: "invoice-save-draft", act: "do" },
      { el: "invoice-issue" },
      { el: "invoice-download" },
      { el: "invoice-send" },
      { el: "invoice-mark-paid" },
      { el: "invoice-cancel" },
      { el: "invoice-settings" },
      { el: "invoice-style" },
    ],
  },
  {
    section: "company",
    quick: ["worker-invite", "company-tabs", "company-view-switch", "company-group-filter", "company-status-filter", "company-person-row"],
    full: [
      { el: "company-tabs" },
      { el: "worker-invite", act: "do" },
      { el: "worker-invite-existing" },
      { el: "worker-invite-new" },
      { el: "invite-next" },
      { el: "worker-submit" },
      { el: "worker-invite-done" },
      { el: "company-view-switch", act: "do" },
      { el: "company-group-filter" },
      { el: "company-status-filter" },
      { el: "company-person-row", act: "do" },
      { el: "worker-tabs", act: "do" },
      { el: "worker-assign-task" },
      { el: "worker-rights" },
      { el: "worker-work" },
      { el: "worker-documents-upload" },
      { el: "worker-remove" },
      { el: "worker-dashboard-close" },
      { el: "company-row-menu" },
      { el: "company-move" },
      { el: "company-group-add", act: "do" },
      { el: "company-group-card" },
      { el: "company-group-edit" },
      { el: "company-activity" },
      { el: "company-dashboards" },
    ],
  },
  {
    section: "rewards",
    quick: ["reward-tiles", "reward-team", "reward-person", "reward-approve", "reward-pay", "reward-export"],
    full: [
      { el: "reward-tiles" },
      { el: "reward-team" },
      { el: "reward-person", act: "do" },
      { el: "reward-plan" },
      { el: "reward-template" },
      { el: "reward-rule-add", act: "do" },
      { el: "reward-setup" },
      { el: "reward-add" },
      { el: "reward-work-table" },
      { el: "reward-payouts" },
      { el: "reward-approve" },
      { el: "reward-pay" },
      { el: "reward-export" },
      { el: "reward-mine" },
    ],
  },
  {
    section: "messages",
    quick: ["messages-search", "messages-list", "messages-conversation", "messages-person", "messages-pick"],
    full: [
      { el: "messages-search", act: "do" },
      { el: "messages-list" },
      { el: "messages-conversation", act: "do" },
      { el: "messages-person" },
      { el: "messages-pick" },
      { el: "messages-input", act: "do" },
      { el: "messages-attach" },
      { el: "messages-send" },
      { el: "messages-message-menu" },
      { el: "messages-reply" },
      { el: "messages-edit" },
      { el: "messages-delete" },
      { el: "messages-conversation-menu", act: "do" },
      { el: "messages-pin" },
      { el: "messages-mute" },
      { el: "messages-mute-all" },
      { el: "messages-export" },
    ],
  },
];
