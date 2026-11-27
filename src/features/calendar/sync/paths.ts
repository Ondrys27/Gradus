/** Settings → Calendar, where connections are made and the callback returns to. */
export const CALENDAR_SETTINGS_PATH = "/app/nastaveni/kalendar";
export const GOOGLE_START_PATH = "/api/integrations/google/start";
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";
export const GOOGLE_PUSH_PATH = "/api/integrations/google/push";
export const CALENDAR_SYNC_API = "/api/integrations/calendar";
/** Connecting Google from the scheduler's Availability (30.4) returns there. */
export const GOOGLE_START_FROM_SCHEDULER = `${GOOGLE_START_PATH}?from=scheduler`;
export const SCHEDULER_AVAILABILITY_PATH = "/app/planovac?tab=availability";
