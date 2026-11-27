import type { SectionGuideDef, UiElement } from "./types";

/**
 * Contacts, Cold Calling, the pipeline, the calendar and the scheduler
 * (30.8): the controls the guide points at. Rights mirror how each
 * component hides the control (useCan / canDo / the owner's role); where a
 * control opens for either of two rights (a contact changed by "update" or
 * by calling it), the catalog names the one the section itself rests on.
 */

const CONTACTS = "/app/kontakty";
const TABLES = "/app/kontakty/tabulky";
const CALLS = "/app/cold-calling";
const PIPELINE = "/app/pipeline";
const CALENDAR = "/app/kalendar";
const SCHEDULER = "/app/planovac";
const AVAILABILITY = "/app/planovac?tab=availability";
const BOOKINGS = "/app/planovac?tab=bookings";
const TEAM = "/app/planovac?tab=team";

const contactsCreate = { right: ["contacts", "create"] } as const;
const contactsUpdate = { right: ["contacts", "update"] } as const;
const contactsDelete = { right: ["contacts", "delete"] } as const;
const contactsGenerate = { right: ["contacts", "generate"] } as const;
const call = { right: ["cold_calling", "call"] } as const;
const pipelineView = { right: ["pipeline", "view"] } as const;
const pipelineCreate = { right: ["pipeline", "create"] } as const;
const pipelineUpdate = { right: ["pipeline", "update"] } as const;
const pipelineStage = { right: ["pipeline", "change_stage"] } as const;
const pipelineDelete = { right: ["pipeline", "delete"] } as const;
const invoicesIssue = { right: ["invoices", "issue"] } as const;
const calendarCreate = { right: ["calendar", "create"] } as const;
const calendarUpdate = { right: ["calendar", "update"] } as const;
const schedulerOwn = { right: ["scheduler", "own"] } as const;
const owner = { owner: true } as const;

const detail = ["contact-row"] as const;
const moving = ["contact-row", "contact-move"] as const;
const deal = ["deal-card"] as const;

export const GROUP_B_ELEMENTS: readonly UiElement[] = [
  // Contacts
  { key: "contact-tables", section: "contacts", path: CONTACTS, safe: true },
  { key: "contact-search", section: "contacts", path: CONTACTS, safe: true, input: true },
  { key: "contact-row", section: "contacts", path: CONTACTS, safe: true },
  { key: "contact-new", section: "contacts", path: CONTACTS, needs: [contactsCreate], safe: true },
  { key: "contact-form", section: "contacts", path: CONTACTS, via: ["contact-new"], needs: [contactsCreate], input: true },
  // "⋯" beside New contact (30.9): generating and the tables live under it
  { key: "contacts-more", section: "contacts", path: CONTACTS, safe: true },
  { key: "contact-generate", section: "contacts", path: CONTACTS, via: ["contacts-more"], needs: [contactsGenerate], safe: true },
  { key: "contact-generate-industry", section: "contacts", path: CONTACTS, via: ["contacts-more", "contact-generate"], needs: [contactsGenerate], input: true },
  { key: "generate-submit", section: "contacts", path: CONTACTS, via: ["contacts-more", "contact-generate"], needs: [contactsGenerate] },
  { key: "generate-show", section: "contacts", path: CONTACTS, via: ["contacts-more", "contact-generate"], needs: [contactsGenerate], safe: true },
  { key: "contact-tables-edit", section: "contacts", path: CONTACTS, via: ["contacts-more"], needs: [contactsUpdate], safe: true },
  { key: "contact-table-add", section: "contacts", path: TABLES, needs: [contactsUpdate], safe: true },
  { key: "contact-table-questions", section: "contacts", path: TABLES, needs: [contactsUpdate], safe: true },
  { key: "contact-question-add", section: "contacts", path: TABLES, via: ["contact-table-questions"], needs: [contactsUpdate], safe: true },
  { key: "contact-edit", section: "contacts", path: CONTACTS, via: detail, needs: [contactsUpdate], safe: true },
  { key: "contact-move", section: "contacts", path: CONTACTS, via: detail, needs: [contactsUpdate], safe: true },
  { key: "move-table-", section: "contacts", path: CONTACTS, prefix: true },
  { key: "move-today", section: "contacts", path: CONTACTS, via: moving, needs: [contactsUpdate] },
  { key: "move-confirm", section: "contacts", path: CONTACTS, via: moving, needs: [contactsUpdate] },
  { key: "deal-offer-create", section: "contacts", path: CONTACTS, via: moving, needs: [contactsUpdate, pipelineCreate], safe: true },
  { key: "contact-schedule-meeting", section: "contacts", path: CONTACTS, via: detail, needs: [contactsUpdate], safe: true },
  { key: "contact-activity", section: "contacts", path: CONTACTS, via: detail },
  { key: "contact-notes", section: "contacts", path: CONTACTS, via: detail, input: true },
  { key: "contact-deals", section: "contacts", path: CONTACTS, via: detail, needs: [pipelineView] },
  { key: "contact-delete", section: "contacts", path: CONTACTS, via: detail, needs: [contactsDelete] },

  // Cold Calling
  { key: "call-list", section: "coldCalling", path: CALLS },
  { key: "call-search", section: "coldCalling", path: CALLS, safe: true, input: true },
  { key: "call-contact", section: "coldCalling", path: CALLS, safe: true },
  { key: "call-dial", section: "coldCalling", path: CALLS, via: ["call-contact"] },
  { key: "call-move", section: "coldCalling", path: CALLS, via: ["call-contact"], needs: [call], safe: true },
  { key: "call-create-deal", section: "coldCalling", path: CALLS, via: ["call-contact"], needs: [pipelineCreate], safe: true },
  { key: "call-open-detail", section: "coldCalling", path: CALLS, via: ["call-contact"], needs: [{ right: ["contacts", "view"] }], safe: true },
  { key: "call-timer", section: "coldCalling", path: CALLS },
  { key: "call-timer-start", section: "coldCalling", path: CALLS, needs: [call] },
  { key: "call-timer-pause", section: "coldCalling", path: CALLS, needs: [call] },
  { key: "call-stats", section: "coldCalling", path: CALLS },
  { key: "call-stats-period", section: "coldCalling", path: CALLS, safe: true },
  { key: "call-stats-people", section: "coldCalling", path: CALLS, needs: [{ right: ["cold_calling", "view_others_stats"] }], safe: true },
  { key: "call-best-time", section: "coldCalling", path: CALLS },
  { key: "call-best-industries", section: "coldCalling", path: CALLS },

  // Pipeline
  { key: "pipeline-health", section: "pipeline", path: PIPELINE, safe: true },
  { key: "pipeline-filters", section: "pipeline", path: PIPELINE, safe: true },
  { key: "pipeline-filter-panel", section: "pipeline", path: PIPELINE, via: ["pipeline-filters"], safe: true },
  { key: "stage-", section: "pipeline", path: PIPELINE, prefix: true },
  { key: "pipeline-new-deal", section: "pipeline", path: PIPELINE, needs: [pipelineCreate], safe: true },
  { key: "pipeline-column-add-deal", section: "pipeline", path: PIPELINE, needs: [pipelineCreate], safe: true },
  { key: "deal-form", section: "pipeline", path: PIPELINE, via: ["pipeline-new-deal"], needs: [pipelineCreate], input: true },
  { key: "deal-create", section: "pipeline", path: PIPELINE, via: ["pipeline-new-deal"], needs: [pipelineCreate] },
  // "⋯" beside New deal (30.9): the stages live under it
  { key: "pipeline-more", section: "pipeline", path: PIPELINE, needs: [pipelineUpdate], safe: true },
  { key: "pipeline-edit-stages", section: "pipeline", path: PIPELINE, via: ["pipeline-more"], needs: [pipelineUpdate], safe: true },
  { key: "pipeline-add-stage", section: "pipeline", path: PIPELINE, via: ["pipeline-more"], needs: [pipelineUpdate], safe: true },
  { key: "deal-card", section: "pipeline", path: PIPELINE, safe: true },
  { key: "deal-tabs", section: "pipeline", path: PIPELINE, via: deal, safe: true },
  { key: "deal-title", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineUpdate], input: true },
  { key: "deal-stage", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineStage], safe: true },
  { key: "deal-properties", section: "pipeline", path: PIPELINE, via: deal },
  { key: "deal-people", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineUpdate], safe: true },
  { key: "deal-contacts", section: "pipeline", path: PIPELINE, via: deal },
  { key: "deal-tasks", section: "pipeline", path: PIPELINE, via: deal },
  { key: "deal-history", section: "pipeline", path: PIPELINE, via: deal },
  { key: "deal-notes", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineUpdate], input: true },
  { key: "deal-email", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineUpdate, contactsUpdate], safe: true },
  { key: "deal-create-invoice", section: "pipeline", path: PIPELINE, via: deal, needs: [invoicesIssue] },
  { key: "deal-delete", section: "pipeline", path: PIPELINE, via: deal, needs: [pipelineDelete] },

  // Calendar
  { key: "calendar-new", section: "calendar", path: CALENDAR, needs: [calendarCreate], safe: true },
  { key: "calendar-event-form", section: "calendar", path: CALENDAR, via: ["calendar-new"], needs: [calendarCreate], input: true },
  { key: "calendar-event-kind", section: "calendar", path: CALENDAR, via: ["calendar-new"], needs: [calendarCreate], safe: true },
  { key: "calendar-event-private", section: "calendar", path: CALENDAR, via: ["calendar-new"], needs: [calendarCreate] },
  { key: "calendar-nav", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-views", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-mirrors", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-item", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-event-edit", section: "calendar", path: CALENDAR, via: ["calendar-item"], needs: [calendarUpdate], safe: true },
  { key: "calendar-event-delete", section: "calendar", path: CALENDAR, via: ["calendar-item"], needs: [calendarUpdate] },
  { key: "calendar-panel-open", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-panel", section: "calendar", path: CALENDAR },
  { key: "calendar-share-request", section: "calendar", path: CALENDAR, safe: true },
  { key: "calendar-request-form", section: "calendar", path: CALENDAR, via: ["calendar-share-request"], input: true },
  { key: "calendar-common-time", section: "calendar", path: CALENDAR, needs: [calendarCreate], safe: true },
  { key: "calendar-common-time-panel", section: "calendar", path: CALENDAR, via: ["calendar-common-time"], needs: [calendarCreate] },

  // Scheduler
  { key: "scheduler-tabs", section: "scheduler", path: SCHEDULER, safe: true },
  { key: "scheduler-link", section: "scheduler", path: SCHEDULER },
  { key: "copy-link", section: "scheduler", path: SCHEDULER, safe: true },
  { key: "scheduler-profile-edit", section: "scheduler", path: SCHEDULER, needs: [schedulerOwn], safe: true },
  { key: "scheduler-new-type", section: "scheduler", path: SCHEDULER, needs: [schedulerOwn], safe: true },
  { key: "scheduler-type-name", section: "scheduler", path: SCHEDULER, via: ["scheduler-new-type"], needs: [schedulerOwn], input: true },
  { key: "scheduler-type-tabs", section: "scheduler", path: SCHEDULER, via: ["scheduler-new-type"], needs: [schedulerOwn], safe: true },
  { key: "scheduler-type-save", section: "scheduler", path: SCHEDULER, via: ["scheduler-new-type"], needs: [schedulerOwn] },
  { key: "scheduler-type-open", section: "scheduler", path: SCHEDULER, needs: [schedulerOwn], safe: true },
  { key: "scheduler-type-toggle", section: "scheduler", path: SCHEDULER, needs: [schedulerOwn] },
  { key: "scheduler-calendars", section: "scheduler", path: AVAILABILITY, needs: [schedulerOwn] },
  { key: "scheduler-week", section: "scheduler", path: AVAILABILITY, needs: [schedulerOwn] },
  { key: "scheduler-exceptions", section: "scheduler", path: AVAILABILITY, needs: [schedulerOwn] },
  { key: "scheduler-booking-filters", section: "scheduler", path: BOOKINGS, safe: true },
  { key: "scheduler-booking", section: "scheduler", path: BOOKINGS, safe: true },
  { key: "scheduler-team", section: "scheduler", path: TEAM, needs: [owner] },
];

export const GROUP_B_GUIDES: readonly SectionGuideDef[] = [
  {
    section: "contacts",
    quick: ["contact-tables", "contact-search", "contact-row", "contact-new", "contacts-more"],
    full: [
      { el: "contact-tables", act: "do" },
      { el: "contact-search", act: "do" },
      { el: "contact-new", act: "do" },
      { el: "contact-form" },
      { el: "contacts-more" },
      { el: "contact-generate" },
      { el: "contact-generate-industry" },
      { el: "generate-submit" },
      { el: "generate-show" },
      { el: "contact-row", act: "do" },
      { el: "contact-edit" },
      { el: "contact-move", act: "do" },
      { el: "move-today" },
      { el: "move-confirm" },
      { el: "deal-offer-create" },
      { el: "contact-schedule-meeting" },
      { el: "contact-activity" },
      { el: "contact-notes" },
      { el: "contact-deals" },
      { el: "contact-delete" },
      { el: "contact-tables-edit" },
      { el: "contact-table-add" },
      { el: "contact-table-questions", act: "do" },
      { el: "contact-question-add" },
    ],
  },
  {
    section: "coldCalling",
    quick: ["call-timer", "call-list", "call-search", "call-contact", "call-stats", "call-best-time"],
    full: [
      { el: "call-timer" },
      { el: "call-timer-start" },
      { el: "call-timer-pause" },
      { el: "call-list" },
      { el: "call-search", act: "do" },
      { el: "call-contact", act: "do" },
      { el: "call-dial" },
      { el: "call-move", act: "do" },
      { el: "call-create-deal" },
      { el: "call-open-detail" },
      { el: "call-stats" },
      { el: "call-stats-period", act: "do" },
      { el: "call-stats-people" },
      { el: "call-best-time" },
      { el: "call-best-industries" },
    ],
  },
  {
    section: "pipeline",
    quick: ["pipeline-health", "pipeline-filters", "deal-card", "pipeline-new-deal", "pipeline-column-add-deal", "pipeline-more"],
    full: [
      { el: "pipeline-health", act: "do" },
      { el: "pipeline-filters", act: "do" },
      { el: "pipeline-filter-panel" },
      { el: "pipeline-new-deal", act: "do" },
      { el: "deal-form" },
      { el: "deal-create" },
      { el: "pipeline-column-add-deal" },
      { el: "pipeline-more" },
      { el: "pipeline-edit-stages" },
      { el: "pipeline-add-stage" },
      { el: "deal-card", act: "do" },
      { el: "deal-title" },
      { el: "deal-stage" },
      { el: "deal-properties" },
      { el: "deal-people" },
      { el: "deal-contacts" },
      { el: "deal-tasks" },
      { el: "deal-history" },
      { el: "deal-notes" },
      { el: "deal-email" },
      { el: "deal-create-invoice" },
      { el: "deal-delete" },
    ],
  },
  {
    section: "calendar",
    quick: ["calendar-new", "calendar-nav", "calendar-views", "calendar-mirrors", "calendar-item", "calendar-panel"],
    full: [
      { el: "calendar-nav" },
      { el: "calendar-views", act: "do" },
      { el: "calendar-mirrors", act: "do" },
      { el: "calendar-new", act: "do" },
      { el: "calendar-event-form" },
      { el: "calendar-event-kind" },
      { el: "calendar-event-private" },
      { el: "calendar-item", act: "do" },
      { el: "calendar-event-edit" },
      { el: "calendar-event-delete" },
      { el: "calendar-panel-open" },
      { el: "calendar-panel" },
      { el: "calendar-share-request" },
      { el: "calendar-request-form" },
      { el: "calendar-common-time", act: "do" },
      { el: "calendar-common-time-panel" },
    ],
  },
  {
    section: "scheduler",
    quick: ["scheduler-tabs", "scheduler-link", "copy-link", "scheduler-new-type", "scheduler-type-open", "scheduler-type-toggle"],
    full: [
      { el: "scheduler-tabs", act: "do" },
      { el: "scheduler-link" },
      { el: "copy-link", act: "do" },
      { el: "scheduler-profile-edit" },
      { el: "scheduler-new-type", act: "do" },
      { el: "scheduler-type-name" },
      { el: "scheduler-type-tabs" },
      { el: "scheduler-type-save" },
      { el: "scheduler-type-open" },
      { el: "scheduler-type-toggle" },
      { el: "scheduler-calendars" },
      { el: "scheduler-week" },
      { el: "scheduler-exceptions" },
      { el: "scheduler-booking-filters" },
      { el: "scheduler-booking" },
      { el: "scheduler-team" },
    ],
  },
];
