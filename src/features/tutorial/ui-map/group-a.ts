import type { SectionGuideDef, UiElement } from "./types";

/**
 * The dashboard, milestones, notes and sales tasks (30.8): the controls the
 * guide points at. Rights mirror how each component hides the control
 * (useCan("milestones", "edit"), canCreateTask / canEditTask, notes only in
 * the account's own space).
 */

const DASHBOARD = "/app";
const MILESTONES = "/app/milniky";
const NOTES = "/app/poznamky";
const TASKS = "/app/ukoly-crm";

const milestonesEdit = { right: ["milestones", "edit"] } as const;
const tasksCreate = { right: ["tasks", "create"] } as const;
const tasksUpdate = { right: ["tasks", "update"] } as const;
const tasksDelete = { right: ["tasks", "delete"] } as const;
const owner = { owner: true } as const;

/** A milestone's own page: open a card first. */
const IN_MILESTONE = ["milestone-card"] as const;
/** An open note: pick one in the list first. */
const IN_NOTE = ["note-item"] as const;

export const GROUP_A_ELEMENTS: readonly UiElement[] = [
  // Dashboard
  { key: "dashboard-summary", section: "dashboard", path: DASHBOARD },
  { key: "dashboard-widgets", section: "dashboard", path: DASHBOARD },
  { key: "widget-", section: "dashboard", path: DASHBOARD, prefix: true },
  { key: "dashboard-tabs", section: "dashboard", path: DASHBOARD, safe: true },
  { key: "dashboard-new-tab", section: "dashboard", path: DASHBOARD, safe: true },
  { key: "dashboard-edit", section: "dashboard", path: DASHBOARD, safe: true },
  { key: "dashboard-add-widget", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"], safe: true },
  {
    key: "dashboard-gallery-search",
    section: "dashboard",
    path: DASHBOARD,
    via: ["dashboard-edit", "dashboard-add-widget"],
    safe: true,
    input: true,
  },
  { key: "dashboard-gallery-add", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit", "dashboard-add-widget"] },
  { key: "dashboard-widget-settings", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"], safe: true },
  { key: "dashboard-widget-resize", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"], safe: true },
  { key: "dashboard-widget-remove", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"] },
  { key: "dashboard-undo", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"] },
  { key: "dashboard-reset", section: "dashboard", path: DASHBOARD, via: ["dashboard-edit"], safe: true },

  // Milestones
  { key: "milestone-new", section: "milestones", path: MILESTONES, needs: [milestonesEdit], safe: true },
  { key: "milestone-title", section: "milestones", path: MILESTONES, via: ["milestone-new"], needs: [milestonesEdit], input: true },
  { key: "milestone-reward", section: "milestones", path: MILESTONES, via: ["milestone-new"], needs: [milestonesEdit], input: true },
  { key: "milestone-import", section: "milestones", path: MILESTONES, needs: [milestonesEdit], safe: true },
  { key: "milestone-filter", section: "milestones", path: MILESTONES, safe: true },
  { key: "milestone-path-view", section: "milestones", path: MILESTONES, safe: true },
  { key: "milestone-card", section: "milestones", path: MILESTONES, safe: true },
  { key: "milestone-edit", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit], safe: true },
  { key: "milestone-delete", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit], safe: true },
  { key: "milestone-complete", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit] },
  { key: "task-add", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit], input: true },
  { key: "task-row", section: "milestones", path: MILESTONES, via: IN_MILESTONE },
  { key: "task-menu", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit], safe: true },
  { key: "task-view", section: "milestones", path: MILESTONES, via: IN_MILESTONE, safe: true },
  { key: "task-view-", section: "milestones", path: MILESTONES, via: IN_MILESTONE, prefix: true },
  { key: "map-import", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [milestonesEdit], safe: true },
  { key: "map-export", section: "milestones", path: MILESTONES, via: IN_MILESTONE, safe: true },
  { key: "milestone-notes", section: "milestones", path: MILESTONES, via: IN_MILESTONE, needs: [owner] },

  // Notes
  { key: "note-new", section: "notes", path: NOTES },
  { key: "note-new-menu", section: "notes", path: NOTES, safe: true },
  { key: "note-new-text", section: "notes", path: NOTES, via: ["note-new-menu"] },
  { key: "note-new-map", section: "notes", path: NOTES, via: ["note-new-menu"] },
  { key: "note-new-import", section: "notes", path: NOTES, via: ["note-new-menu"], safe: true },
  { key: "notes-search", section: "notes", path: NOTES, safe: true, input: true },
  { key: "notes-nav", section: "notes", path: NOTES },
  { key: "notes-shared", section: "notes", path: NOTES, safe: true },
  { key: "notes-folder-new", section: "notes", path: NOTES, safe: true },
  { key: "notes-trash", section: "notes", path: NOTES, safe: true },
  { key: "note-item", section: "notes", path: NOTES, safe: true },
  { key: "note-row-delete", section: "notes", path: NOTES },
  { key: "note-toolbar", section: "notes", path: NOTES, via: IN_NOTE },
  { key: "note-mention", section: "notes", path: NOTES, via: IN_NOTE },
  { key: "note-share", section: "notes", path: NOTES, via: IN_NOTE, safe: true },
  { key: "note-versions", section: "notes", path: NOTES, via: IN_NOTE, safe: true },
  { key: "note-move", section: "notes", path: NOTES, via: IN_NOTE, safe: true },
  { key: "note-pin", section: "notes", path: NOTES, via: IN_NOTE },
  { key: "note-delete", section: "notes", path: NOTES, via: IN_NOTE },
  { key: "note-more", section: "notes", path: NOTES, via: IN_NOTE, safe: true },
  { key: "note-map-add", section: "notes", path: NOTES, via: IN_NOTE },
  { key: "note-map-suggest", section: "notes", path: NOTES, via: IN_NOTE, safe: true },

  // Sales tasks
  { key: "task-new", section: "tasks", path: TASKS, needs: [tasksCreate], safe: true },
  { key: "crm-task-title", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate], input: true },
  { key: "crm-task-target", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate], input: true },
  {
    key: "task-target-option",
    section: "tasks",
    path: TASKS,
    via: ["task-new", "crm-task-target"],
    needs: [tasksCreate],
  },
  { key: "crm-task-due-quick", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate] },
  { key: "crm-task-duration", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate] },
  { key: "crm-task-assignee", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate], safe: true },
  { key: "task-submit", section: "tasks", path: TASKS, via: ["task-new"], needs: [tasksCreate] },
  { key: "crm-task-quick", section: "tasks", path: TASKS, safe: true },
  { key: "crm-task-filters", section: "tasks", path: TASKS, safe: true },
  { key: "crm-task-row", section: "tasks", path: TASKS, safe: true },
  { key: "crm-task-done-group", section: "tasks", path: TASKS, safe: true },
  { key: "crm-task-edit", section: "tasks", path: TASKS, via: ["crm-task-row"], needs: [tasksUpdate], safe: true },
  { key: "crm-task-complete", section: "tasks", path: TASKS, via: ["crm-task-row"], safe: true },
  { key: "crm-task-note", section: "tasks", path: TASKS, via: ["crm-task-row", "crm-task-complete"], input: true },
  { key: "crm-task-delete", section: "tasks", path: TASKS, via: ["crm-task-row"], needs: [tasksDelete] },
];

export const GROUP_A_GUIDES: readonly SectionGuideDef[] = [
  {
    section: "dashboard",
    quick: ["dashboard-summary", "dashboard-widgets", "dashboard-tabs", "dashboard-new-tab", "dashboard-edit"],
    full: [
      { el: "dashboard-summary" },
      { el: "dashboard-widgets" },
      { el: "dashboard-tabs" },
      { el: "dashboard-new-tab" },
      { el: "dashboard-edit", act: "do" },
      { el: "dashboard-add-widget", act: "do" },
      { el: "dashboard-gallery-search", act: "do" },
      { el: "dashboard-gallery-add" },
      { el: "dashboard-widget-settings" },
      { el: "dashboard-widget-resize" },
      { el: "dashboard-widget-remove" },
      { el: "dashboard-undo" },
      { el: "dashboard-reset" },
    ],
  },
  {
    section: "milestones",
    quick: ["milestone-new", "milestone-import", "milestone-filter", "milestone-path-view", "milestone-card"],
    full: [
      { el: "milestone-filter", act: "do" },
      { el: "milestone-path-view" },
      { el: "milestone-new", act: "do" },
      { el: "milestone-title", act: "do" },
      { el: "milestone-reward" },
      { el: "milestone-import" },
      { el: "milestone-card", act: "do" },
      { el: "task-add", act: "do" },
      { el: "task-row" },
      { el: "task-menu", act: "do" },
      { el: "task-view", act: "do" },
      { el: "map-import" },
      { el: "map-export" },
      { el: "milestone-notes" },
      { el: "milestone-edit" },
      { el: "milestone-complete" },
      { el: "milestone-delete" },
    ],
  },
  {
    section: "notes",
    quick: ["note-new", "note-new-menu", "notes-search", "notes-nav", "note-item", "notes-trash"],
    full: [
      { el: "note-new" },
      { el: "note-new-menu", act: "do" },
      { el: "note-new-text" },
      { el: "note-new-map" },
      { el: "note-new-import" },
      { el: "notes-search", act: "do" },
      { el: "notes-nav" },
      { el: "notes-shared" },
      { el: "notes-folder-new" },
      { el: "note-item", act: "do" },
      { el: "note-toolbar" },
      { el: "note-mention" },
      { el: "note-share" },
      { el: "note-versions" },
      { el: "note-move" },
      { el: "note-pin" },
      { el: "note-more" },
      { el: "note-map-add" },
      { el: "note-map-suggest" },
      { el: "note-delete" },
      { el: "note-row-delete" },
      { el: "notes-trash" },
    ],
  },
  {
    section: "tasks",
    quick: ["task-new", "crm-task-quick", "crm-task-filters", "crm-task-row", "crm-task-done-group"],
    full: [
      { el: "crm-task-quick", act: "do" },
      { el: "crm-task-filters", act: "do" },
      { el: "crm-task-row" },
      { el: "crm-task-done-group" },
      { el: "task-new", act: "do" },
      { el: "crm-task-title", act: "do" },
      { el: "crm-task-target" },
      { el: "task-target-option" },
      { el: "crm-task-due-quick" },
      { el: "crm-task-duration" },
      { el: "crm-task-assignee" },
      { el: "task-submit" },
      { el: "crm-task-complete" },
      { el: "crm-task-note" },
      { el: "crm-task-edit" },
      { el: "crm-task-delete" },
    ],
  },
];
