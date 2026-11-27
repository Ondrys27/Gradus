-- =============================================================================
-- The person's own menu (step 30.9)
--   * user_settings.nav_prefs: which sections are pinned (top of the menu,
--     first in the phone bar), hidden (out of the menu, the address still
--     works) and in what order inside their groups. JSON object with the
--     arrays `pinned`, `hidden` and `order` of section keys; the shape is
--     checked by valid_nav_prefs() = parseNavPrefs() in
--     src/components/layout/nav-prefs.ts. The person writes their own row,
--     as with the other settings.
-- Additive only: one new column with a default and its check.
-- =============================================================================

create or replace function public.valid_nav_prefs(_p jsonb)
returns boolean
language sql
immutable
as $$
  select _p is not null
    and jsonb_typeof(_p) = 'object'
    and octet_length(_p::text) <= 2000
    and not exists (
      select 1 from jsonb_each(_p) e
      where e.key not in ('pinned', 'hidden', 'order')
         or jsonb_typeof(e.value) <> 'array'
         or jsonb_array_length(e.value) > 30
    )
    and not exists (
      select 1 from jsonb_each(_p) e, jsonb_array_elements(e.value) v
      where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 30
    );
$$;

revoke execute on function public.valid_nav_prefs(jsonb) from public, anon;
grant execute on function public.valid_nav_prefs(jsonb) to authenticated, service_role;

alter table public.user_settings
  add column if not exists nav_prefs jsonb not null default '{}'::jsonb;

alter table public.user_settings drop constraint if exists user_settings_nav_prefs_valid;
alter table public.user_settings
  add constraint user_settings_nav_prefs_valid check (public.valid_nav_prefs(nav_prefs));
