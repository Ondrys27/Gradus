-- =============================================================================
-- Collapsible sidebar (19.1)
--   * user_settings.sidebar_collapsed: on wide screens the menu shows icons
--     only. Kept on the account so it follows the user to every device; the
--     app layout reads it with the rest of the settings, so the first HTML
--     already has the right width.
--   * Written by the user through the existing own-row policies of
--     user_settings; a setting, so it stays writable in read-only mode.
-- =============================================================================

alter table public.user_settings
  add column sidebar_collapsed boolean not null default false;
