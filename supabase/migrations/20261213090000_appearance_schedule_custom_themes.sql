-- =============================================================================
-- Themes through the day and custom themes (step 30.6)
--   * user_settings.theme_schedule: blocks of the day (name, start minute,
--     theme, optional caption), one list for every day, weekdays + weekend or
--     each weekday on its own; null = never set up. The shape is checked by
--     valid_theme_schedule() = parseThemeSchedule() in
--     src/features/appearance/schedule.ts. In game mode a block may only use
--     an unlocked built-in theme (the same rule as user_settings.theme).
--   * user_settings.custom_theme_id: the user's custom theme picked by hand
--     (null = the built-in user_settings.theme); theme_override_until: a theme
--     picked by hand while the schedule is on holds until the next block.
--   * custom_themes: a person's own themes (at most 12), name + tokens (the
--     choices of colours and options, valid_custom_theme_tokens() =
--     parseCustomThemeTokens(); its text must read, custom_theme_readable() =
--     isReadable()). Private like the settings: only the person's own rows,
--     writable in a read-only space too. Every theme has a share code made by
--     the database; custom_theme_by_code() lets a colleague (an active member
--     of a company the author is an active member of) read it to import a copy.
--   * the plan catalog gets the flag `custom_themes` (missing = on); with it
--     off no new custom theme can be made (existing ones keep working).
-- Additive only: new columns (null), a new table, functions replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The shape of a custom theme and its contrast
-- -----------------------------------------------------------------------------

create or replace function public.valid_custom_theme_tokens(_t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(_t) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(_t) as k(key)
      where k.key not in ('v', 'base', 'colors', 'radius', 'density', 'backdrop', 'headingFont', 'shadow')
    )
    and _t -> 'v' = '1'::jsonb
    and _t ->> 'base' in ('dark', 'light')
    and _t ->> 'density' in ('compact', 'comfortable', 'spacious')
    and _t ->> 'backdrop' in ('solid', 'gradient', 'glow')
    and _t ->> 'headingFont' in ('inter', 'poppins', 'bricolage', 'space_grotesk', 'fraunces', 'sora')
    and _t ->> 'shadow' in ('none', 'soft', 'normal', 'strong')
    and jsonb_typeof(_t -> 'radius') = 'number'
    and (_t ->> 'radius')::numeric between 0 and 24
    and (_t ->> 'radius')::numeric = trunc((_t ->> 'radius')::numeric)
    and jsonb_typeof(_t -> 'colors') = 'object'
    and not exists (
      select 1 from jsonb_each(_t -> 'colors') as c(key, value)
      where c.key not in ('canvas', 'surface', 'ink', 'accent', 'accent2', 'success', 'warning', 'danger')
        or jsonb_typeof(c.value) <> 'string'
        or (c.value #>> '{}') !~ '^#[0-9a-f]{6}$'
    )
    and (_t -> 'colors') ?& array['canvas', 'surface', 'ink', 'accent', 'accent2'],
    false);
$$;
revoke execute on function public.valid_custom_theme_tokens(jsonb) from public, anon;
grant execute on function public.valid_custom_theme_tokens(jsonb) to authenticated, service_role;

-- WCAG 2 relative luminance of a #rrggbb colour (= relativeLuminance() in color.ts).
create or replace function public.hex_luminance(_hex text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  with channel(n, v) as (
    values
      (1, ('x' || substr(_hex, 2, 2))::bit(8)::int / 255.0),
      (2, ('x' || substr(_hex, 4, 2))::bit(8)::int / 255.0),
      (3, ('x' || substr(_hex, 6, 2))::bit(8)::int / 255.0)
  ), linear(n, v) as (
    select n, case when v <= 0.04045 then v / 12.92 else power((v + 0.055) / 1.055, 2.4) end
    from channel
  )
  select (0.2126 * (select v from linear where n = 1)
    + 0.7152 * (select v from linear where n = 2)
    + 0.0722 * (select v from linear where n = 3))::double precision;
$$;
revoke execute on function public.hex_luminance(text) from public, anon;
grant execute on function public.hex_luminance(text) to authenticated, service_role;

create or replace function public.hex_contrast(_a text, _b text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select (greatest(public.hex_luminance(_a), public.hex_luminance(_b)) + 0.05)
    / (least(public.hex_luminance(_a), public.hex_luminance(_b)) + 0.05);
$$;
revoke execute on function public.hex_contrast(text, text) from public, anon;
grant execute on function public.hex_contrast(text, text) to authenticated, service_role;

-- Whether the theme reads (= isReadable()): text AA (4.5) on the background
-- and on cards, the accents and chosen states AA for UI parts (3) on cards.
create or replace function public.custom_theme_readable(_t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.valid_custom_theme_tokens(_t)
    and public.hex_contrast(_t #>> '{colors,ink}', _t #>> '{colors,canvas}') >= 4.5
    and public.hex_contrast(_t #>> '{colors,ink}', _t #>> '{colors,surface}') >= 4.5
    and not exists (
      select 1 from jsonb_each_text(_t -> 'colors') as c(key, value)
      where c.key in ('accent', 'accent2', 'success', 'warning', 'danger')
        and public.hex_contrast(c.value, _t #>> '{colors,surface}') < 3
    );
$$;
revoke execute on function public.custom_theme_readable(jsonb) from public, anon;
grant execute on function public.custom_theme_readable(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The plan: the catalog's flag `custom_themes` (missing = available)
-- -----------------------------------------------------------------------------

create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'included_workers', 'limits',
      'features', 'recommended', 'order', 'mcp', 'custom_themes']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb',
      'scheduler_types']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    when not public.plan_catalog_money_ok(_p -> 'monthly') then false
    when not public.plan_catalog_money_ok(_p -> 'yearly') then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'yearly')
      and (select bool_and(coalesce(
             public.plan_catalog_number(_p -> 'yearly' -> c)
               <= 12 * public.plan_catalog_number(_p -> 'monthly' -> c), false))
           from jsonb_object_keys(_p -> 'monthly') as c)
      and (jsonb_typeof(_p -> 'per_worker') = 'null'
        or (public.plan_catalog_money_ok(_p -> 'per_worker')
          and public.plan_catalog_same_currencies(_p -> 'monthly', _p -> 'per_worker')))
      and (not (_p ? 'included_workers') or public.plan_catalog_count_ok(_p -> 'included_workers', false))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and (not (_p -> 'limits' ? 'scheduler_types')
        or public.plan_catalog_count_ok(_p -> 'limits' -> 'scheduler_types', true))
      and (not (_p ? 'mcp') or jsonb_typeof(_p -> 'mcp') = 'boolean')
      and (not (_p ? 'custom_themes') or jsonb_typeof(_p -> 'custom_themes') = 'boolean')
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- Whether the account's own plan lets it make custom themes: the published
-- catalog's flag; beta, other plans and older versions yes.
create or replace function public.plan_allows_custom_themes(_account uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _key text;
  _plan jsonb;
begin
  select s.plan_key into _key from public.subscriptions s where s.user_id = _account;
  if _key is null then
    return true;
  end if;
  _plan := public.published_plan(_key);
  if _plan is null or not (_plan ? 'custom_themes') then
    return true;
  end if;
  return coalesce((_plan ->> 'custom_themes')::boolean, true);
end;
$$;
revoke execute on function public.plan_allows_custom_themes(uuid) from public, anon, authenticated;
grant execute on function public.plan_allows_custom_themes(uuid) to service_role;

-- The signed-in account's own answer, for Settings → Appearance and the guard.
create or replace function public.custom_themes_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.plan_allows_custom_themes(auth.uid());
$$;
revoke execute on function public.custom_themes_allowed() from public, anon;
grant execute on function public.custom_themes_allowed() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. custom_themes
-- -----------------------------------------------------------------------------

-- 10 characters of the short ID's alphabet (no 0/O/1/I/L), unique.
create or replace function public.new_theme_share_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  _bytes bytea;
  _code text;
begin
  loop
    _bytes := uuid_send(gen_random_uuid());
    _code := '';
    for _i in 0..9 loop
      _code := _code || substr(_alphabet, (get_byte(_bytes, _i) % 30) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.custom_themes t where t.share_code = _code);
  end loop;
  return _code;
end;
$$;
-- Only a random code: the guard (running as the caller) needs it.
revoke execute on function public.new_theme_share_code() from public, anon;
grant execute on function public.new_theme_share_code() to authenticated, service_role;

create table public.custom_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  tokens jsonb not null,
  share_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_themes_name check (char_length(btrim(name)) between 1 and 40 and name = btrim(name)),
  constraint custom_themes_tokens check (public.valid_custom_theme_tokens(tokens)),
  constraint custom_themes_readable check (public.custom_theme_readable(tokens)),
  constraint custom_themes_share_code check (share_code ~ '^[2-9A-HJKMNP-TV-Z]{10}$')
);

comment on table public.custom_themes is
  'A person''s own custom themes (30.6), at most 12; tokens = choices of colours and options, every CSS variable is derived in the app.';

create unique index custom_themes_share_code_idx on public.custom_themes (share_code);
create index custom_themes_user_idx on public.custom_themes (user_id, created_at);

-- At most 12 per person, only with the plan's flag; who, the code and the
-- times are the database's.
create or replace function public.custom_themes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      raise exception 'custom_theme_denied' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('custom_themes:' || new.user_id, 0));
    if (select count(*) from public.custom_themes t where t.user_id = new.user_id) >= 12 then
      raise exception 'custom_theme_limit' using errcode = 'P0001';
    end if;
    if public.is_client_request() and not public.custom_themes_allowed() then
      raise exception 'custom_themes_plan' using errcode = 'P0001';
    end if;
    new.share_code := public.new_theme_share_code();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  new.user_id := old.user_id;
  new.share_code := old.share_code;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.custom_themes_guard() from public, anon, authenticated;

create trigger custom_themes_guard
  before insert or update on public.custom_themes
  for each row execute function public.custom_themes_guard();

alter table public.custom_themes enable row level security;

create policy "custom_themes_own" on public.custom_themes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.custom_themes from anon, authenticated;
grant select, delete on public.custom_themes to authenticated;
grant insert (name, tokens) on public.custom_themes to authenticated;
grant update (name, tokens) on public.custom_themes to authenticated;
grant select, insert, update, delete on public.custom_themes to service_role;

-- A colleague's theme by its code, to import a copy: only for the author and
-- for active members of a company the author is an active member of.
create or replace function public.custom_theme_by_code(_code text)
returns table (name text, tokens jsonb, author text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, t.tokens, coalesce(nullif(btrim(p.display_name), ''), '') as author
  from public.custom_themes t
  left join public.profiles p on p.id = t.user_id
  where auth.uid() is not null
    and t.share_code = upper(btrim(_code))
    and (
      t.user_id = auth.uid()
      or exists (
        select 1
        from public.memberships mine
        join public.memberships theirs on theirs.space_id = mine.space_id
        where mine.user_id = auth.uid()
          and theirs.user_id = t.user_id
          and mine.status = 'active'
          and theirs.status = 'active'
      )
    )
  limit 1;
$$;
revoke execute on function public.custom_theme_by_code(text) from public, anon;
grant execute on function public.custom_theme_by_code(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. The schedule and the manual pick in user_settings
-- -----------------------------------------------------------------------------

create or replace function public.valid_theme_schedule(_s jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _keys text[];
  _key text;
  _list jsonb;
  _block jsonb;
  _prev integer;
  _start numeric;
  _ids text[];
  _ref text;
begin
  if _s is null then
    return true;
  end if;
  if jsonb_typeof(_s) <> 'object' or octet_length(_s::text) > 20000 then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(_s) as k(key) where k.key not in ('v', 'enabled', 'mode', 'days')) then
    return false;
  end if;
  if _s -> 'v' is distinct from '1'::jsonb or jsonb_typeof(_s -> 'enabled') is distinct from 'boolean' then
    return false;
  end if;
  _keys := case _s ->> 'mode'
    when 'same' then array['all']
    when 'weekdays' then array['weekdays', 'weekend']
    when 'each' then array['0', '1', '2', '3', '4', '5', '6']
  end;
  if _keys is null or jsonb_typeof(_s -> 'days') is distinct from 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(_s -> 'days') as k(key) where not (k.key = any (_keys))) then
    return false;
  end if;
  foreach _key in array _keys loop
    _list := _s -> 'days' -> _key;
    if jsonb_typeof(_list) is distinct from 'array' or jsonb_array_length(_list) not between 2 and 8 then
      return false;
    end if;
    _prev := -1;
    _ids := array[]::text[];
    for _block in select e.value from jsonb_array_elements(_list) as e(value) loop
      if jsonb_typeof(_block) <> 'object' then
        return false;
      end if;
      if exists (
        select 1 from jsonb_object_keys(_block) as k(key)
        where k.key not in ('id', 'name', 'start', 'theme', 'caption')
      ) then
        return false;
      end if;
      if jsonb_typeof(_block -> 'id') is distinct from 'string'
        or (_block ->> 'id') !~ '^[a-zA-Z0-9_-]{1,40}$'
        or (_block ->> 'id') = any (_ids) then
        return false;
      end if;
      _ids := _ids || (_block ->> 'id');
      if jsonb_typeof(_block -> 'name') is distinct from 'string'
        or char_length(_block ->> 'name') not between 1 and 40
        or (_block ->> 'name') <> btrim(_block ->> 'name') then
        return false;
      end if;
      if jsonb_typeof(_block -> 'start') is distinct from 'number' then
        return false;
      end if;
      _start := (_block ->> 'start')::numeric;
      if _start <> trunc(_start) or _start < 0 or _start > 1439 or _start <= _prev then
        return false;
      end if;
      _prev := _start::integer;
      _ref := _block ->> 'theme';
      if jsonb_typeof(_block -> 'theme') is distinct from 'string'
        or not (
          _ref in ('gradus', 'midnight', 'forest', 'sunset', 'steel', 'light')
          or _ref ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ) then
        return false;
      end if;
      if _block ? 'caption' and jsonb_typeof(_block -> 'caption') <> 'null' then
        if jsonb_typeof(_block -> 'caption') <> 'string'
          or char_length(_block ->> 'caption') not between 1 and 120
          or (_block ->> 'caption') <> btrim(_block ->> 'caption') then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;
revoke execute on function public.valid_theme_schedule(jsonb) from public, anon;
grant execute on function public.valid_theme_schedule(jsonb) to authenticated, service_role;

alter table public.user_settings
  add column if not exists theme_schedule jsonb,
  add column if not exists custom_theme_id uuid references public.custom_themes (id) on delete set null,
  add column if not exists theme_override_until timestamptz;

alter table public.user_settings
  add constraint user_settings_theme_schedule_valid check (public.valid_theme_schedule(theme_schedule));

create index if not exists user_settings_custom_theme_idx
  on public.user_settings (custom_theme_id) where custom_theme_id is not null;

-- Runs as the caller: a picked custom theme and every custom theme of the
-- schedule are the account's own; in game mode a built-in theme of the
-- schedule must be open (theme_available, as for user_settings.theme).
create or replace function public.user_settings_appearance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _ref text;
begin
  if not public.is_client_request() then
    return new;
  end if;
  if new.custom_theme_id is not null
     and (tg_op = 'INSERT' or new.custom_theme_id is distinct from old.custom_theme_id)
     and not exists (
       select 1 from public.custom_themes t where t.id = new.custom_theme_id and t.user_id = new.user_id
     ) then
    raise exception 'custom_theme_missing' using errcode = 'P0001';
  end if;
  if new.theme_schedule is not null
     and (tg_op = 'INSERT' or new.theme_schedule is distinct from old.theme_schedule) then
    for _ref in
      select distinct b.value ->> 'theme'
      from jsonb_each(new.theme_schedule -> 'days') as d(key, value),
           jsonb_array_elements(d.value) as b(value)
    loop
      if _ref like 'custom:%' then
        if not exists (
          select 1 from public.custom_themes t
          where t.id = substr(_ref, 8)::uuid and t.user_id = new.user_id
        ) then
          raise exception 'custom_theme_missing' using errcode = 'P0001';
        end if;
      elsif not public.theme_available(_ref) then
        raise exception 'theme_locked' using errcode = 'insufficient_privilege';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke execute on function public.user_settings_appearance_guard() from public, anon, authenticated;

drop trigger if exists user_settings_appearance_guard on public.user_settings;
create trigger user_settings_appearance_guard
  before insert or update of theme_schedule, custom_theme_id on public.user_settings
  for each row execute function public.user_settings_appearance_guard();

-- -----------------------------------------------------------------------------
-- 5. Analytics events (src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('theme_schedule_saved', 'settings', true),
  ('theme_transition_played', 'settings', false),
  ('custom_theme_saved', 'settings', true),
  ('custom_theme_deleted', 'settings', true),
  ('custom_theme_shared', 'settings', true)
on conflict (event) do nothing;
