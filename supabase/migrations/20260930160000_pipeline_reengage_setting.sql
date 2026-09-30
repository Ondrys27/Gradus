-- =============================================================================
-- Pipeline: configurable re-engage window
--   * reengage_after_months replaces the hardcoded six-month rule; the
--     "possible to re-engage" badge and its column filter both read it
-- =============================================================================

alter table public.user_settings
  add column reengage_after_months integer not null default 6
    check (reengage_after_months >= 1);
