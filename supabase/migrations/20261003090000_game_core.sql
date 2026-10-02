-- =============================================================================
-- Game core (step 9.3)
--   * profiles.mode: 'game' (XP, levels, unlocks, path, badges) or 'tool'
--     (everything open, no XP). XP and progress stay in the database either
--     way; switching back to game restores them, and sections the account
--     already uses stay open
--   * paths / path_milestones / path_tasks: templates per industry. Choosing a
--     path copies them into milestones and tasks with template_id; the user
--     then edits them freely. template_id is server-only, so a custom
--     milestone can never pretend to be a template and unlock a section
--   * unlock_definitions: every unlockable thing (section, feature, theme,
--     Jarvis skill). Sources: a template milestone's unlock_key and a level
--     (level_rewards). Granted unlocks live in the existing unlocks table
--   * award_xp(reason, ref_id) is the only writer of xp_events. It decides the
--     amount, verifies the referenced row is the caller's own real action,
--     applies daily caps and returns the new level, unlocks and badges
--   * achievements / user_achievements: badges evaluated on the server after
--     every award
--   * level, streak and progress are computed, never stored
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Definitions: readable by everyone signed in, written only by migrations
-- -----------------------------------------------------------------------------

create table public.unlock_definitions (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  kind text not null check (kind in ('section', 'feature', 'theme', 'jarvis_skill')),
  name jsonb not null check (name ? 'en' and name ? 'cs'),
  description jsonb not null check (description ? 'en' and description ? 'cs'),
  icon text not null check (char_length(icon) <= 40),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.paths (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  name jsonb not null check (name ? 'en' and name ? 'cs'),
  description jsonb not null check (description ? 'en' and description ? 'cs'),
  icon text not null check (char_length(icon) <= 40),
  industries text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- key names the step itself and is shared across paths ("trade_license" in
-- every path), so changing paths never adds a step the user already has.
create table public.path_milestones (
  id uuid primary key default gen_random_uuid(),
  path_key text not null references public.paths (key) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,60}$'),
  chapter integer not null check (chapter between 1 and 4),
  position integer not null check (position >= 1),
  title jsonb not null check (title ? 'en' and title ? 'cs'),
  description jsonb not null check (description ? 'en' and description ? 'cs'),
  xp integer not null check (xp between 100 and 400),
  unlock_key text references public.unlock_definitions (key),
  reward_hint jsonb check (reward_hint is null or (reward_hint ? 'en' and reward_hint ? 'cs')),
  created_at timestamptz not null default now(),
  unique (path_key, key),
  unique (path_key, chapter, position)
);

create table public.path_tasks (
  id uuid primary key default gen_random_uuid(),
  path_milestone_id uuid not null references public.path_milestones (id) on delete cascade,
  position integer not null check (position >= 1),
  title jsonb not null check (title ? 'en' and title ? 'cs'),
  description jsonb check (description is null or (description ? 'en' and description ? 'cs')),
  created_at timestamptz not null default now(),
  unique (path_milestone_id, position)
);

create table public.level_rewards (
  level integer not null check (level between 2 and 30),
  unlock_key text not null references public.unlock_definitions (key),
  primary key (level, unlock_key)
);
create index level_rewards_unlock_key_idx on public.level_rewards (unlock_key);

-- condition: {"metric": "<name from game_metrics()>", "gte": <number>}
create table public.achievements (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  name jsonb not null check (name ? 'en' and name ? 'cs'),
  description jsonb not null check (description ? 'en' and description ? 'cs'),
  icon text not null check (char_length(icon) <= 40),
  condition jsonb not null check (
    condition ? 'metric' and jsonb_typeof(condition -> 'gte') = 'number'
  ),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_key text not null references public.achievements (key) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_key)
);

do $$
declare
  t text;
begin
  foreach t in array array['unlock_definitions', 'paths', 'path_milestones', 'path_tasks', 'level_rewards', 'achievements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s_select_authenticated" on public.%1$I for select to authenticated using (true)', t);
  end loop;
end;
$$;

-- Read own; no insert/update/delete policy: badges are granted by the server.
alter table public.user_achievements enable row level security;
create policy "user_achievements_select_own" on public.user_achievements
  for select to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Mode and path on the profile; template links on milestones and tasks
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column mode text not null default 'game' check (mode in ('game', 'tool')),
  add column path_key text references public.paths (key) on delete set null;

alter table public.milestones
  add column template_id uuid references public.path_milestones (id) on delete set null;
alter table public.tasks
  add column template_id uuid references public.path_tasks (id) on delete set null;
create index milestones_user_template_idx on public.milestones (user_id, template_id)
  where template_id is not null;

-- Only choose_path() links rows to templates.
create or replace function public.keep_template_server_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.template_id := null;
    else
      new.template_id := old.template_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger milestones_template_server_only
  before insert or update on public.milestones
  for each row execute function public.keep_template_server_only();
create trigger tasks_template_server_only
  before insert or update on public.tasks
  for each row execute function public.keep_template_server_only();

-- The client picks the mode itself; the path only through choose_path().
create or replace function public.profiles_game_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() and new.path_key is distinct from old.path_key then
    raise exception 'path_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger profiles_game_guard
  before update on public.profiles
  for each row execute function public.profiles_game_guard();

-- Sections the account already uses stay open when it (re)enters game mode.
create or replace function public.grant_used_sections(_uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.unlocks (user_id, key, seen_at)
  select _uid, s.key, now()
  from (
    values
      ('section_contacts', exists (select 1 from public.contacts where user_id = _uid)),
      ('section_cold_calling', exists (select 1 from public.prospecting_segments where user_id = _uid)),
      ('section_pipeline', exists (select 1 from public.deals where user_id = _uid)),
      ('section_calendar', exists (select 1 from public.calendar_events where user_id = _uid)),
      ('section_finance', exists (select 1 from public.transactions where user_id = _uid)
                          or exists (select 1 from public.invoices where user_id = _uid)),
      ('section_workers', exists (select 1 from public.workers where owner_id = _uid))
  ) as s(key, used)
  where s.used
  on conflict (user_id, key) do nothing;
$$;

create or replace function public.profiles_mode_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'game' and old.mode is distinct from 'game' then
    perform public.grant_used_sections(new.id);
  end if;
  return new;
end;
$$;
create trigger profiles_mode_changed
  after update of mode on public.profiles
  for each row execute function public.profiles_mode_changed();

-- A completed template milestone grants its unlock, once and for good
-- (reopening the milestone later does not lock the section again).
create or replace function public.milestones_grant_unlock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and new.template_id is not null then
    insert into public.unlocks (user_id, key, unlocked_at)
    select new.user_id, pm.unlock_key, coalesce(new.completed_at, now())
    from public.path_milestones pm
    where pm.id = new.template_id and pm.unlock_key is not null
    on conflict (user_id, key) do nothing;
  end if;
  return new;
end;
$$;
create trigger milestones_grant_unlock
  after update of status on public.milestones
  for each row execute function public.milestones_grant_unlock();

-- -----------------------------------------------------------------------------
-- XP ledger: new reasons next to the legacy kinds already stored
-- -----------------------------------------------------------------------------

alter table public.xp_events drop constraint xp_events_kind_check;
alter table public.xp_events add constraint xp_events_kind_check check (kind in (
  'task_completed', 'milestone_completed', 'deal_won', 'meeting_booked', 'contact_moved',
  'contact_generated', 'call_30min', 'calendar_event', 'transaction_added', 'daily_login',
  -- legacy (step 6.1/6.2), kept so earlier XP still counts
  'section_unlocked', 'prospecting_record', 'contacts_generated_first', 'meeting_tenth',
  'onboarding_completed'
));
create index xp_events_user_kind_created_idx on public.xp_events (user_id, kind, created_at desc);

drop function public.award_xp(text, text, text, jsonb);
drop function public.xp_summary(text);
drop function public.xp_streak(text);
drop function public.award_meeting_tenth();
drop function public.section_unlocks();
drop function public.prospecting_record(text);

-- -----------------------------------------------------------------------------
-- Levels: XP needed for level n is round(120 * n^1.6); level 1 starts at 0.
-- Mirrored in src/features/game/rules.ts.
-- -----------------------------------------------------------------------------

create or replace function public.game_level_threshold(_level integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when _level <= 1 then 0
    else round(120 * power(least(_level, 30)::numeric, 1.6))::bigint
  end;
$$;

create or replace function public.game_level_for_xp(_xp bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(max(n), 1)::integer
  from generate_series(1, 30) as n
  where public.game_level_threshold(n) <= coalesce(_xp, 0);
$$;

create or replace function public.game_timezone(_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.timezone from public.user_settings s where s.user_id = _uid), 'UTC');
$$;

-- -----------------------------------------------------------------------------
-- Streak: a day counts when it has at least one XP action other than the
-- daily login. Today may still be empty. One missed day per calendar week
-- (Monday to Sunday) is bridged by that week's save; a save is spent only
-- when it actually bridges to an earlier active day.
-- Mirrored in src/features/game/rules.ts (computeStreak).
-- -----------------------------------------------------------------------------

create or replace function public.game_streak(_uid uuid, _tz text)
returns table (streak integer, freeze_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _today date := (now() at time zone _tz)::date;
  _days date[];
  _day date;
  _week date;
  _count integer := 0;
  _used date[] := '{}';
  _pending date[] := '{}';
  _guard integer := 0;
begin
  select coalesce(array_agg(distinct (e.created_at at time zone _tz)::date), '{}')
  into _days
  from public.xp_events e
  where e.user_id = _uid
    and e.kind <> 'daily_login'
    and e.created_at >= now() - interval '401 days';

  if _today = any(_days) then
    _count := 1;
  end if;

  _day := _today - 1;
  loop
    _guard := _guard + 1;
    exit when _guard > 400;
    _week := date_trunc('week', _day)::date;
    if _day = any(_days) then
      _count := _count + 1;
      _used := _used || _pending;
      _pending := '{}';
    elsif not (_week = any(_used) or _week = any(_pending)) then
      _pending := _pending || _week;
    else
      exit;
    end if;
    _day := _day - 1;
  end loop;

  return query select _count, not (date_trunc('week', _today)::date = any(_used));
end;
$$;

-- -----------------------------------------------------------------------------
-- Badges: metrics from the user's own rows, compared with achievements.condition
-- -----------------------------------------------------------------------------

create or replace function public.game_metrics(_uid uuid, _tz text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _path text;
  _this_month date := date_trunc('month', (now() at time zone _tz)::date)::date;
  _chapters integer;
  _chapters_done integer;
begin
  select p.path_key into _path from public.profiles p where p.id = _uid;

  with path as (
    select pm.chapter, pm.key from public.path_milestones pm where pm.path_key = _path
  ),
  done as (
    select distinct tpl.key
    from public.milestones m
    join public.path_milestones tpl on tpl.id = m.template_id
    where m.user_id = _uid and m.completed_at is not null
  ),
  chapters as (
    select path.chapter, bool_and(path.key in (select key from done)) as complete
    from path group by path.chapter
  )
  select count(*)::integer, (count(*) filter (where complete))::integer
  into _chapters, _chapters_done
  from chapters;

  return jsonb_build_object(
    'tasks_done', (select count(*) from public.tasks where user_id = _uid and status = 'done'),
    'milestones_completed',
      (select count(*) from public.milestones where user_id = _uid and completed_at is not null),
    'contacts', (select count(*) from public.contacts where user_id = _uid),
    'call_seconds', (
      select coalesce(sum(extract(epoch from public.prospecting_effective_end(s) - s.started_at)), 0)::bigint
      from public.prospecting_segments s
      where s.user_id = _uid and coalesce(s.actor_id, _uid) = _uid
    ),
    'deals_won', (select count(*) from public.deals where user_id = _uid and won_at is not null),
    'streak', (select g.streak from public.game_streak(_uid, _tz) g),
    'task_depth', (
      with recursive tree as (
        select t.id, 1 as depth from public.tasks t
        where t.user_id = _uid and t.parent_task_id is null
        union all
        select t.id, tree.depth + 1 from public.tasks t
        join tree on t.parent_task_id = tree.id
        where tree.depth < 10
      )
      select coalesce(max(depth), 0) from tree
    ),
    'calendar_events', (select count(*) from public.calendar_events where user_id = _uid),
    'meetings', (select count(*) from public.calendar_events where user_id = _uid and kind = 'meeting'),
    -- A finished month with both income and expenses recorded.
    'finance_complete_months', (
      select count(*) from (
        select date_trunc('month', t.occurred_on) as month
        from public.transactions t
        where t.user_id = _uid and t.occurred_on < _this_month
        group by 1
        having bool_or(t.type = 'income') and bool_or(t.type = 'expense')
      ) months
    ),
    'workers', (select count(*) from public.workers where owner_id = _uid and user_id is not null),
    'chapters_completed', coalesce(_chapters_done, 0),
    'path_completed', case when _chapters > 0 and _chapters_done = _chapters then 1 else 0 end
  );
end;
$$;

-- Grants every badge whose condition the metrics meet; returns the new ones.
create or replace function public.game_evaluate_achievements(_uid uuid, _tz text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _metrics jsonb;
  _result jsonb;
begin
  if not exists (
    select 1 from public.achievements a
    where not exists (
      select 1 from public.user_achievements ua
      where ua.user_id = _uid and ua.achievement_key = a.key
    )
  ) then
    return '[]'::jsonb;
  end if;

  _metrics := public.game_metrics(_uid, _tz);

  with earned as (
    insert into public.user_achievements (user_id, achievement_key)
    select _uid, a.key
    from public.achievements a
    where coalesce((_metrics ->> (a.condition ->> 'metric'))::numeric, 0)
          >= (a.condition ->> 'gte')::numeric
    on conflict (user_id, achievement_key) do nothing
    returning achievement_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.key, 'name', a.name, 'description', a.description, 'icon', a.icon
  ) order by a.position), '[]'::jsonb)
  into _result
  from earned
  join public.achievements a on a.key = earned.achievement_key;

  return _result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Daily caps of repeatable sources. Mirrored in src/features/game/rules.ts.
-- -----------------------------------------------------------------------------

create or replace function public.game_daily_cap(_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case _kind
    when 'task_completed' then 200
    when 'milestone_custom' then 300
    when 'deal_won' then 900
    when 'meeting_booked' then 200
    when 'contact_moved' then 50
    when 'contact_generated' then 30
    when 'calendar_event' then 25
    when 'transaction_added' then 25
    else null
  end;
$$;

-- Writes one ledger row, trimmed to what is left of today's cap. Returns the
-- XP actually written (0 when capped out or already awarded).
create or replace function public.game_grant(
  _uid uuid,
  _kind text,
  _key text,
  _xp integer,
  _day_start timestamptz,
  _cap_group text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _group text := coalesce(_cap_group, _kind);
  _cap integer := public.game_daily_cap(_group);
  _used integer;
  _written integer;
begin
  if _cap is not null then
    select coalesce(sum(e.xp), 0) into _used
    from public.xp_events e
    where e.user_id = _uid and e.kind = _kind and e.created_at >= _day_start
      and coalesce(e.metadata ->> 'cap_group', e.kind) = _group;
    _xp := least(_xp, _cap - _used);
  end if;
  if _xp is null or _xp <= 0 then
    return 0;
  end if;

  insert into public.xp_events (user_id, kind, xp, idempotency_key, metadata)
  values (
    _uid, _kind, _xp, left(_key, 100),
    case when _cap_group is null then '{}'::jsonb else jsonb_build_object('cap_group', _cap_group) end
  )
  on conflict (user_id, kind, idempotency_key) do nothing
  returning xp into _written;

  return coalesce(_written, 0);
end;
$$;

create or replace function public.game_unlock_json(_key text, _source text, _level integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'key', d.key, 'kind', d.kind, 'name', d.name, 'description', d.description,
    'icon', d.icon, 'source', _source, 'level', _level
  )
  from public.unlock_definitions d
  where d.key = _key;
$$;

-- -----------------------------------------------------------------------------
-- award_xp: the only way to XP. The amount comes from the reason; the row
-- named by _ref_id must be the caller's own, real and qualifying. Without
-- _ref_id the newest not yet rewarded qualifying row of today is used (for
-- actions whose id the client does not get back: moves, events, transactions,
-- generated contacts). Returns the gain, the level before and after, what the
-- level-up or the milestone unlocked and the badges just earned.
-- -----------------------------------------------------------------------------

create or replace function public.award_xp(_reason text, _ref_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _mode text;
  _tz text;
  _today date;
  _day_start timestamptz;
  _ref uuid;
  _before bigint;
  _after bigint;
  _gained integer := 0;
  _xp integer;
  _id uuid;
  _milestone record;
  _streak integer;
  _level_before integer;
  _level_after integer;
  _unlocks jsonb := '[]'::jsonb;
  _achievements jsonb := '[]'::jsonb;
  _playing boolean;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _reason is null or _reason not in (
    'task_completed', 'milestone_completed', 'deal_won', 'meeting_booked', 'contact_moved',
    'contact_generated', 'call_30min', 'calendar_event', 'transaction_added', 'daily_login'
  ) then
    raise exception 'unknown_xp_reason' using errcode = 'check_violation';
  end if;
  if _ref_id is not null then
    begin
      _ref := _ref_id::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_ref' using errcode = 'check_violation';
    end;
  end if;

  -- One award at a time per user, so two parallel calls cannot both fit under a cap.
  perform pg_advisory_xact_lock(hashtext('award_xp:' || _uid::text));

  select p.mode into _mode from public.profiles p where p.id = _uid;
  _tz := public.game_timezone(_uid);
  _today := (now() at time zone _tz)::date;
  _day_start := _today::timestamp at time zone _tz;
  select coalesce(sum(e.xp), 0) into _before from public.xp_events e where e.user_id = _uid;

  -- Tool mode earns nothing; a worker's actions belong to the owner's space, not to a game.
  _playing := _mode = 'game' and public.current_workspace_id() = _uid;

  if _playing then
    case _reason
    when 'task_completed' then
      select t.id, case when t.parent_task_id is null then 10 else 5 end
      into _id, _xp
      from public.tasks t
      where t.id = _ref and t.user_id = _uid and t.status = 'done'
        and (t.completed_by is null or t.completed_by = _uid);
      if _id is not null then
        _gained := public.game_grant(_uid, 'task_completed', _id::text, _xp, _day_start);
      end if;

    when 'milestone_completed' then
      select m.id, m.template_id, m.completed_at, pm.xp as template_xp, pm.unlock_key
      into _milestone
      from public.milestones m
      left join public.path_milestones pm on pm.id = m.template_id
      where m.id = _ref and m.user_id = _uid and m.status = 'completed';
      if _milestone.id is not null then
        if _milestone.template_xp is not null then
          -- Keyed by the template: deleting and re-adding the step never pays twice.
          _gained := public.game_grant(
            _uid, 'milestone_completed', 'template:' || _milestone.template_id::text,
            _milestone.template_xp, _day_start
          );
        else
          _gained := public.game_grant(
            _uid, 'milestone_completed', _milestone.id::text, 100, _day_start, 'milestone_custom'
          );
        end if;
        if _milestone.unlock_key is not null then
          select coalesce(jsonb_agg(public.game_unlock_json(u.key, 'milestone', null)), '[]'::jsonb)
          into _unlocks
          from public.unlocks u
          where u.user_id = _uid and u.key = _milestone.unlock_key
            and u.unlocked_at >= _milestone.completed_at;
        end if;
      end if;

    when 'deal_won' then
      select d.id, 150 + least(150, floor(greatest(coalesce(d.value, 0), 0) / 1000))::integer
      into _id, _xp
      from public.deals d
      where d.id = _ref and d.user_id = _uid and d.won_at is not null;
      if _id is not null then
        _gained := public.game_grant(_uid, 'deal_won', _id::text, _xp, _day_start);
      end if;

    when 'meeting_booked', 'calendar_event' then
      select e.id into _id
      from public.calendar_events e
      where e.user_id = _uid and coalesce(e.actor_id, _uid) = _uid
        and (e.kind = 'meeting') = (_reason = 'meeting_booked')
        and (case when _ref is not null then e.id = _ref else e.created_at >= _day_start end)
        and not exists (
          select 1 from public.xp_events x
          where x.user_id = _uid and x.kind = _reason and x.idempotency_key = e.id::text
        )
      order by e.created_at desc
      limit 1;
      if _id is not null then
        _gained := public.game_grant(
          _uid, _reason, _id::text, case when _reason = 'meeting_booked' then 40 else 5 end, _day_start
        );
      end if;

    when 'contact_moved' then
      select m.id into _id
      from public.contact_table_moves m
      where m.user_id = _uid and coalesce(m.actor_id, _uid) = _uid
        and (case when _ref is not null then m.id = _ref else m.created_at >= _day_start end)
        and not exists (
          select 1 from public.xp_events x
          where x.user_id = _uid and x.kind = 'contact_moved' and x.idempotency_key = m.id::text
        )
      order by m.created_at desc
      limit 1;
      if _id is not null then
        _gained := public.game_grant(_uid, 'contact_moved', _id::text, 5, _day_start);
      end if;

    when 'transaction_added' then
      -- Only what the user typed in; bookings by the pipeline, Fakturoid or
      -- recurring payments are not the user's action.
      select t.id into _id
      from public.transactions t
      where t.user_id = _uid and t.source = 'manual'
        and (case when _ref is not null then t.id = _ref else t.created_at >= _day_start end)
        and not exists (
          select 1 from public.xp_events x
          where x.user_id = _uid and x.kind = 'transaction_added' and x.idempotency_key = t.id::text
        )
      order by t.created_at desc
      limit 1;
      if _id is not null then
        _gained := public.game_grant(_uid, 'transaction_added', _id::text, 5, _day_start);
      end if;

    when 'contact_generated' then
      for _id in
        select c.id
        from public.contacts c
        where c.user_id = _uid and c.source = 'generated'
          and (case when _ref is not null then c.id = _ref else c.created_at >= _day_start end)
          and not exists (
            select 1 from public.xp_events x
            where x.user_id = _uid and x.kind = 'contact_generated' and x.idempotency_key = c.id::text
          )
        order by c.created_at
        limit 30
      loop
        _xp := public.game_grant(_uid, 'contact_generated', _id::text, 1, _day_start);
        exit when _xp = 0;
        _gained := _gained + _xp;
      end loop;

    when 'call_30min' then
      if public.prospecting_seconds_for_day(_today, _tz) >= 1800 then
        _gained := public.game_grant(_uid, 'call_30min', _today::text, 30, _day_start);
      end if;

    when 'daily_login' then
      select g.streak into _streak from public.game_streak(_uid, _tz) g;
      _gained := public.game_grant(
        _uid, 'daily_login', _today::text, 10 * least(3, greatest(1, _streak)), _day_start
      );
    end case;
  end if;

  _after := _before + _gained;
  _level_before := public.game_level_for_xp(_before);
  _level_after := public.game_level_for_xp(_after);

  if _level_after > _level_before then
    insert into public.unlocks (user_id, key)
    select _uid, r.unlock_key
    from public.level_rewards r
    where r.level > _level_before and r.level <= _level_after
    on conflict (user_id, key) do nothing;

    select _unlocks || coalesce(jsonb_agg(
      public.game_unlock_json(r.unlock_key, 'level', r.level) order by r.level, r.unlock_key
    ), '[]'::jsonb)
    into _unlocks
    from public.level_rewards r
    where r.level > _level_before and r.level <= _level_after;
  end if;

  if _playing then
    _achievements := public.game_evaluate_achievements(_uid, _tz);
  end if;

  select g.streak into _streak from public.game_streak(_uid, _tz) g;

  return jsonb_build_object(
    'awarded', _gained > 0,
    'xp', _gained,
    'reason', _reason,
    'total_xp', _after,
    'previous_level', _level_before,
    'level', _level_after,
    'leveled_up', _level_after > _level_before,
    'unlocks', _unlocks,
    'achievements', _achievements,
    'streak', _streak
  );
end;
$$;

-- Badges for actions that give no XP (a worker who accepted the invite).
create or replace function public.evaluate_achievements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if public.current_workspace_id() <> _uid
     or (select p.mode from public.profiles p where p.id = _uid) is distinct from 'game' then
    return '[]'::jsonb;
  end if;
  return public.game_evaluate_achievements(_uid, public.game_timezone(_uid));
end;
$$;

-- -----------------------------------------------------------------------------
-- game_state: everything the interface needs in one read
-- -----------------------------------------------------------------------------

create or replace function public.game_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _mode text;
  _path text;
  _tz text;
  _total bigint;
  _level integer;
  _streak integer;
  _freeze boolean;
  _unlocked text[];
  _sections jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select p.mode, p.path_key into _mode, _path from public.profiles p where p.id = _uid;
  _mode := coalesce(_mode, 'game');
  _tz := public.game_timezone(_uid);
  select coalesce(sum(e.xp), 0) into _total from public.xp_events e where e.user_id = _uid;
  _level := public.game_level_for_xp(_total);
  select g.streak, g.freeze_available into _streak, _freeze from public.game_streak(_uid, _tz) g;

  if _mode = 'tool' then
    select array_agg(d.key order by d.position) into _unlocked from public.unlock_definitions d;
  else
    select array_agg(distinct k) into _unlocked from (
      select u.key as k from public.unlocks u where u.user_id = _uid
      union
      select r.unlock_key from public.level_rewards r where r.level <= _level
    ) keys;
  end if;
  _unlocked := coalesce(_unlocked, '{}');

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key,
    'unlocked', d.key = any(_unlocked),
    'unlocked_at', u.unlocked_at,
    'seen_at', u.seen_at,
    'level', (select min(r.level) from public.level_rewards r where r.unlock_key = d.key),
    'milestone', (
      select jsonb_build_object('id', m.id, 'title', m.title, 'completed', m.completed_at is not null)
      from public.milestones m
      join public.path_milestones pm on pm.id = m.template_id
      where m.user_id = _uid and pm.unlock_key = d.key
      order by m.position
      limit 1
    ),
    'template_title', (
      select pm.title from public.path_milestones pm
      where pm.path_key = _path and pm.unlock_key = d.key
      limit 1
    )
  ) order by d.position), '[]'::jsonb)
  into _sections
  from public.unlock_definitions d
  left join public.unlocks u on u.user_id = _uid and u.key = d.key
  where d.kind = 'section';

  return jsonb_build_object(
    'mode', _mode,
    'path_key', _path,
    'total_xp', _total,
    'level', _level,
    'level_xp', public.game_level_threshold(_level),
    'next_level_xp', case when _level >= 30 then null else public.game_level_threshold(_level + 1) end,
    'streak', _streak,
    'streak_freeze_available', _freeze,
    'unlocked', to_jsonb(_unlocked),
    'sections', _sections
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- choose_path: copies a path's templates into the user's milestones and tasks.
-- Steps the user already has (same key, from any path) are skipped. When the
-- path changes, steps of the old path that are untouched (not completed, no
-- task done) are removed; completed and started ones stay.
-- -----------------------------------------------------------------------------

create or replace function public.choose_path(_path_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old text;
  _locale text;
  _position integer;
  _pm public.path_milestones;
  _milestone_id uuid;
  _added integer := 0;
  _removed integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if public.current_workspace_id() <> _uid then
    raise exception 'workers_have_no_path' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.paths where key = _path_key) then
    raise exception 'unknown_path' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('choose_path:' || _uid::text));

  select p.path_key into _old from public.profiles p where p.id = _uid;
  select coalesce(s.locale, 'en') into _locale from public.user_settings s where s.user_id = _uid;
  _locale := case when _locale = 'cs' then 'cs' else 'en' end;

  if _old is not null and _old <> _path_key then
    with gone as (
      delete from public.milestones m
      using public.path_milestones pm
      where m.template_id = pm.id
        and pm.path_key = _old
        and m.user_id = _uid
        and m.completed_at is null
        and not exists (
          select 1 from public.tasks t where t.milestone_id = m.id and t.status = 'done'
        )
      returning 1
    )
    select count(*)::integer into _removed from gone;
  end if;

  select coalesce(max(m.position), -1) + 1 into _position
  from public.milestones m where m.user_id = _uid;

  for _pm in
    select pm.* from public.path_milestones pm
    where pm.path_key = _path_key
      and not exists (
        select 1 from public.milestones m
        join public.path_milestones have on have.id = m.template_id
        where m.user_id = _uid and have.key = pm.key
      )
    order by pm.chapter, pm.position
  loop
    insert into public.milestones (user_id, title, description, position, template_id)
    values (
      _uid,
      coalesce(_pm.title ->> _locale, _pm.title ->> 'en'),
      coalesce(_pm.description ->> _locale, _pm.description ->> 'en'),
      _position,
      _pm.id
    )
    returning id into _milestone_id;

    insert into public.tasks (user_id, milestone_id, title, description, position, template_id)
    select
      _uid, _milestone_id,
      coalesce(pt.title ->> _locale, pt.title ->> 'en'),
      coalesce(pt.description ->> _locale, pt.description ->> 'en'),
      pt.position - 1,
      pt.id
    from public.path_tasks pt
    where pt.path_milestone_id = _pm.id
    order by pt.position;

    _position := _position + 1;
    _added := _added + 1;
  end loop;

  update public.profiles set path_key = _path_key where id = _uid;

  return jsonb_build_object('path_key', _path_key, 'added', _added, 'removed', _removed);
end;
$$;

-- -----------------------------------------------------------------------------
-- Personal record on the phone: now only a check (no XP; the XP for calling
-- is call_30min in award_xp). The interface celebrates it once a day.
-- -----------------------------------------------------------------------------

create function public.prospecting_record(_timezone text)
returns table (is_record boolean, seconds integer, previous_best integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _today date := (now() at time zone _timezone)::date;
  _today_seconds integer;
  _best integer;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  _today_seconds := public.prospecting_seconds_for_day(_today, _timezone);
  select coalesce(max(d.seconds), 0) into _best
  from public.prospecting_daily_seconds(_today - 400, _today - 1, _timezone, _uid) d;
  return query select _today_seconds > 0 and _today_seconds > _best, _today_seconds, _best;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke execute on function
  public.keep_template_server_only(),
  public.profiles_game_guard(),
  public.profiles_mode_changed(),
  public.milestones_grant_unlock(),
  public.grant_used_sections(uuid),
  public.game_timezone(uuid),
  public.game_streak(uuid, text),
  public.game_metrics(uuid, text),
  public.game_evaluate_achievements(uuid, text),
  public.game_grant(uuid, text, text, integer, timestamptz, text),
  public.game_unlock_json(text, text, integer)
from public, anon, authenticated;

revoke execute on function
  public.award_xp(text, text),
  public.evaluate_achievements(),
  public.game_state(),
  public.choose_path(text),
  public.prospecting_record(text),
  public.game_level_threshold(integer),
  public.game_level_for_xp(bigint),
  public.game_daily_cap(text)
from public, anon;

grant execute on function
  public.award_xp(text, text),
  public.evaluate_achievements(),
  public.game_state(),
  public.choose_path(text),
  public.prospecting_record(text),
  public.game_level_threshold(integer),
  public.game_level_for_xp(bigint),
  public.game_daily_cap(text)
to authenticated;

-- =============================================================================
-- Definitions
-- =============================================================================

insert into public.unlock_definitions (key, kind, name, description, icon, position) values
  ('section_contacts', 'section',
   '{"en": "Contacts", "cs": "Kontakty"}',
   '{"en": "People and companies in your own tables.", "cs": "Lidé a firmy ve vlastních tabulkách."}',
   'contact-round', 1),
  ('section_cold_calling', 'section',
   '{"en": "Cold Calling", "cs": "Cold Calling"}',
   '{"en": "Call timer, statistics and the best time to call.", "cs": "Časovač volání, statistiky a nejlepší čas na hovor."}',
   'phone-call', 2),
  ('section_pipeline', 'section',
   '{"en": "Pipeline", "cs": "Pipeline"}',
   '{"en": "Deals by stage, from the first contact to the win.", "cs": "Obchody po fázích od prvního kontaktu po výhru."}',
   'square-kanban', 3),
  ('section_calendar', 'section',
   '{"en": "Calendar", "cs": "Kalendář"}',
   '{"en": "Meetings, calls and reminders in one place.", "cs": "Schůzky, hovory a připomínky na jednom místě."}',
   'calendar-days', 4),
  ('section_finance', 'section',
   '{"en": "Finance", "cs": "Finance"}',
   '{"en": "Income, expenses, invoices and recurring payments.", "cs": "Příjmy, výdaje, faktury a pravidelné platby."}',
   'wallet', 5),
  ('section_workers', 'section',
   '{"en": "Workers", "cs": "Pracovníci"}',
   '{"en": "Invite helpers, give them tasks and rewards.", "cs": "Pozvi pomocníky, zadávej jim úkoly a odměny."}',
   'users-round', 6),
  ('best_industries', 'feature',
   '{"en": "Best industries", "cs": "Nejlepší obory"}',
   '{"en": "Which generated industries end in a meeting most often.", "cs": "Které obory z generování kontaktů nejčastěji končí schůzkou."}',
   'trending-up', 10),
  ('theme_aurora', 'theme',
   '{"en": "Aurora theme", "cs": "Téma Polární záře"}',
   '{"en": "Green and violet glow over the night sky.", "cs": "Zelená a fialová záře nad nočním nebem."}',
   'palette', 20),
  ('theme_ocean', 'theme',
   '{"en": "Deep Ocean theme", "cs": "Téma Hlubina"}',
   '{"en": "Calm deep blues and turquoise.", "cs": "Klidné hluboké modré a tyrkysová."}',
   'palette', 21),
  ('theme_sunset', 'theme',
   '{"en": "Sunset theme", "cs": "Téma Západ slunce"}',
   '{"en": "Warm orange and pink evening light.", "cs": "Teplé oranžové a růžové večerní světlo."}',
   'palette', 22),
  ('theme_emerald', 'theme',
   '{"en": "Emerald theme", "cs": "Téma Smaragd"}',
   '{"en": "Deep green with a gold accent.", "cs": "Sytá zelená se zlatým akcentem."}',
   'palette', 23),
  ('theme_gold', 'theme',
   '{"en": "Golden Age theme", "cs": "Téma Zlatý věk"}',
   '{"en": "Gold on black for those who made it.", "cs": "Zlatá na černé pro ty, kdo to dokázali."}',
   'palette', 24),
  ('jarvis_morning_brief', 'jarvis_skill',
   '{"en": "Morning brief", "cs": "Ranní shrnutí"}',
   '{"en": "Jarvis sums up your day every morning: meetings, calls back, tasks.", "cs": "Jarvis ti každé ráno shrne den: schůzky, volání zpět, úkoly."}',
   'sunrise', 30),
  ('jarvis_weekly_analysis', 'jarvis_skill',
   '{"en": "Weekly analysis", "cs": "Týdenní analýza"}',
   '{"en": "Every week Jarvis looks at your calls, deals and money and says what to change.", "cs": "Jarvis každý týden projde hovory, obchody a peníze a řekne, co změnit."}',
   'chart-line', 31),
  ('jarvis_industry_advice', 'jarvis_skill',
   '{"en": "Industry advice", "cs": "Doporučení oborů"}',
   '{"en": "Jarvis recommends which industries to target next, based on your own results.", "cs": "Jarvis podle tvých výsledků doporučí, na které obory se zaměřit."}',
   'compass', 32),
  ('title_5', 'feature',
   '{"en": "Title: Diligent Apprentice", "cs": "Titul: Pilný učeň"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 40),
  ('title_10', 'feature',
   '{"en": "Title: Established Trader", "cs": "Titul: Zavedený živnostník"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 41),
  ('title_15', 'feature',
   '{"en": "Title: Seasoned Dealmaker", "cs": "Titul: Ostřílený obchodník"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 42),
  ('title_20', 'feature',
   '{"en": "Title: Successful Entrepreneur", "cs": "Titul: Úspěšný podnikatel"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 43),
  ('title_25', 'feature',
   '{"en": "Title: Master Strategist", "cs": "Titul: Mistr strategie"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 44),
  ('title_30', 'feature',
   '{"en": "Title: Living Legend", "cs": "Titul: Živoucí legenda"}',
   '{"en": "A title shown next to your name.", "cs": "Titul u tvého jména."}',
   'award', 45);

insert into public.level_rewards (level, unlock_key) values
  (3, 'theme_aurora'),
  (5, 'jarvis_morning_brief'),
  (5, 'title_5'),
  (7, 'theme_ocean'),
  (10, 'section_workers'),
  (10, 'title_10'),
  (12, 'theme_sunset'),
  (15, 'jarvis_weekly_analysis'),
  (15, 'title_15'),
  (18, 'theme_emerald'),
  (20, 'jarvis_industry_advice'),
  (20, 'title_20'),
  (25, 'theme_gold'),
  (25, 'title_25'),
  (30, 'title_30');

insert into public.achievements (key, name, description, icon, condition, position) values
  ('first_task',
   '{"en": "First Step", "cs": "První krok"}',
   '{"en": "Complete your first task.", "cs": "Dokonči první úkol."}',
   'footprints', '{"metric": "tasks_done", "gte": 1}', 1),
  ('first_milestone',
   '{"en": "On the Way", "cs": "Na cestě"}',
   '{"en": "Complete your first milestone.", "cs": "Dokonči první milník."}',
   'flag', '{"metric": "milestones_completed", "gte": 1}', 2),
  ('networker',
   '{"en": "Networker", "cs": "Síťař"}',
   '{"en": "Have 50 contacts.", "cs": "Měj 50 kontaktů."}',
   'contact-round', '{"metric": "contacts", "gte": 50}', 3),
  ('caller',
   '{"en": "Phone Pro", "cs": "Telefonista"}',
   '{"en": "Spend 10 hours on the phone with the timer running.", "cs": "Provolej 10 hodin se spuštěným časovačem."}',
   'phone-call', '{"metric": "call_seconds", "gte": 36000}', 4),
  ('closed',
   '{"en": "Closed", "cs": "Uzavřeno"}',
   '{"en": "Win your first deal.", "cs": "Vyhraj první obchod."}',
   'handshake', '{"metric": "deals_won", "gte": 1}', 5),
  ('high_five',
   '{"en": "High Five", "cs": "Pětka"}',
   '{"en": "Win five deals.", "cs": "Vyhraj pět obchodů."}',
   'trophy', '{"metric": "deals_won", "gte": 5}', 6),
  ('streak_7',
   '{"en": "Streak 7", "cs": "Série 7"}',
   '{"en": "Earn XP seven days in a row.", "cs": "Získej XP sedm dní po sobě."}',
   'flame', '{"metric": "streak", "gte": 7}', 7),
  ('streak_30',
   '{"en": "Streak 30", "cs": "Série 30"}',
   '{"en": "Earn XP thirty days in a row.", "cs": "Získej XP třicet dní po sobě."}',
   'flame', '{"metric": "streak", "gte": 30}', 8),
  ('mapper',
   '{"en": "Mapper", "cs": "Mapař"}',
   '{"en": "Build a task tree three levels deep.", "cs": "Postav strom úkolů se třemi úrovněmi."}',
   'network', '{"metric": "task_depth", "gte": 3}', 9),
  ('planner',
   '{"en": "Planner", "cs": "Plánovač"}',
   '{"en": "Add 10 events to the calendar.", "cs": "Přidej do kalendáře 10 událostí."}',
   'calendar-days', '{"metric": "calendar_events", "gte": 10}', 10),
  ('accountant',
   '{"en": "Accountant", "cs": "Účetní"}',
   '{"en": "Finish a month with both income and expenses recorded.", "cs": "Uzavři měsíc se zapsanými příjmy i výdaji."}',
   'calculator', '{"metric": "finance_complete_months", "gte": 1}', 11),
  ('boss',
   '{"en": "Boss", "cs": "Šéf"}',
   '{"en": "Your first worker accepts the invite.", "cs": "První pracovník přijme pozvánku."}',
   'crown', '{"metric": "workers", "gte": 1}', 12),
  ('eloquent',
   '{"en": "Smooth Talker", "cs": "Výmluvný"}',
   '{"en": "Book 10 meetings.", "cs": "Domluv 10 schůzek."}',
   'message-circle', '{"metric": "meetings", "gte": 10}', 13),
  ('marathon',
   '{"en": "Marathoner", "cs": "Maratonec"}',
   '{"en": "Complete 100 tasks.", "cs": "Dokonči 100 úkolů."}',
   'medal', '{"metric": "tasks_done", "gte": 100}', 14),
  ('chapter',
   '{"en": "Chapter", "cs": "Kapitola"}',
   '{"en": "Finish a whole chapter of your path.", "cs": "Dokonči celou kapitolu své cesty."}',
   'book-open', '{"metric": "chapters_completed", "gte": 1}', 15),
  ('path',
   '{"en": "The Path", "cs": "Cesta"}',
   '{"en": "Finish your whole path.", "cs": "Dokonči celou svou cestu."}',
   'mountain', '{"metric": "path_completed", "gte": 1}', 16);

-- =============================================================================
-- Existing accounts: Contacts and Pipeline were always open before, the other
-- sections they already use stay open too. Nothing glows as new.
-- =============================================================================

insert into public.unlocks (user_id, key, seen_at)
select p.id, k.key, now()
from public.profiles p
cross join (values ('section_contacts'), ('section_pipeline')) as k(key)
on conflict (user_id, key) do nothing;

select public.grant_used_sections(p.id) from public.profiles p;
