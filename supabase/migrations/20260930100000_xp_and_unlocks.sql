-- =============================================================================
-- XP, streaks and section unlocks
--   * xp_events is the only ledger; total XP, level and streak are always
--     computed from it, never stored
--   * award_xp() is the single place XP amounts are decided, so the client
--     can never grant itself points; idempotency_key makes every award safe
--     to request more than once (task/deal/day/etc.)
--   * section_unlocks() grants Cold Calling, Calendar, Finance and Workers
--     from the user's own real counts and reuses the existing unlocks table
--     (server grants, client only marks seen_at, per unlocks_guard)
--   * prospecting_record() and award_meeting_tenth() are one-off checks that
--     award XP the same idempotent way
-- =============================================================================

-- Confetti and card animations can be turned off independently of sound.
alter table public.user_settings
  add column animations_enabled boolean not null default true;

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'milestone_completed', 'deal_won', 'section_unlocked', 'prospecting_record',
    'contacts_generated_first', 'meeting_tenth', 'task_completed', 'contact_moved'
  )),
  xp integer not null check (xp > 0),
  idempotency_key text not null check (char_length(idempotency_key) <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, kind, idempotency_key)
);
create index xp_events_user_created_idx on public.xp_events (user_id, created_at desc);

alter table public.xp_events enable row level security;
create policy "xp_events_select_own" on public.xp_events
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert/update/delete policy: every row is written by award_xp() below.

-- -----------------------------------------------------------------------------
-- Streak: consecutive days with at least one xp_events row, in the caller's
-- zone. Today may still be empty without breaking it (the day is not over).
-- -----------------------------------------------------------------------------

create or replace function public.xp_streak(_timezone text)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _day date := (now() at time zone _timezone)::date;
  _streak integer := 0;
  _has boolean;
  _today_pending boolean := true;
  _guard integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  loop
    _guard := _guard + 1;
    exit when _guard > 3650;
    select exists (
      select 1 from public.xp_events
      where user_id = _uid and (created_at at time zone _timezone)::date = _day
    ) into _has;
    if _has then
      _streak := _streak + 1;
      _today_pending := false;
      _day := _day - 1;
    elsif _today_pending then
      _today_pending := false;
      _day := _day - 1;
    else
      exit;
    end if;
  end loop;
  return _streak;
end;
$$;

create or replace function public.xp_summary(_timezone text)
returns table (total_xp bigint, streak integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce((select sum(e.xp) from public.xp_events e where e.user_id = auth.uid()), 0),
    public.xp_streak(_timezone);
$$;

-- -----------------------------------------------------------------------------
-- award_xp: the only writer of xp_events. The amount comes from _kind, never
-- from the caller. _idempotency_key makes a repeated call for the same real
-- event (the same task, deal, day, section...) a no-op the second time.
-- -----------------------------------------------------------------------------

create or replace function public.award_xp(
  _kind text,
  _idempotency_key text,
  _timezone text default 'UTC',
  _metadata jsonb default '{}'::jsonb
)
returns table (awarded boolean, xp integer, total_xp bigint, streak integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _xp integer;
  _inserted boolean := false;
  _total bigint;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _idempotency_key is null or btrim(_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = 'check_violation';
  end if;

  _xp := case _kind
    when 'milestone_completed' then 150
    when 'deal_won' then 200
    when 'section_unlocked' then 100
    when 'contacts_generated_first' then 60
    when 'meeting_tenth' then 120
    when 'task_completed' then 10
    when 'contact_moved' then 5
    else null
  end;
  if _xp is null then
    raise exception 'unknown_xp_kind' using errcode = 'check_violation';
  end if;

  with ins as (
    insert into public.xp_events (user_id, kind, xp, idempotency_key, metadata)
    values (_uid, _kind, _xp, left(_idempotency_key, 100), coalesce(_metadata, '{}'::jsonb))
    on conflict (user_id, kind, idempotency_key) do nothing
    returning 1
  )
  select exists (select 1 from ins) into _inserted;

  select coalesce(sum(e.xp), 0) into _total from public.xp_events e where e.user_id = _uid;

  return query
  select _inserted, case when _inserted then _xp else 0 end, _total, public.xp_streak(_timezone);
end;
$$;

revoke execute on function public.award_xp(text, text, text, jsonb) from public, anon;
grant execute on function public.award_xp(text, text, text, jsonb) to authenticated;
revoke execute on function public.xp_streak(text) from public, anon;
grant execute on function public.xp_streak(text) to authenticated;
revoke execute on function public.xp_summary(text) from public, anon;
grant execute on function public.xp_summary(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Personal record: today's prospecting seconds beat every earlier day. Checked
-- (and awarded) on demand, typically right after a pause; nothing is stored
-- beyond the xp_events row itself, so a call that finds no record is a no-op.
-- -----------------------------------------------------------------------------

create or replace function public.prospecting_record(_timezone text)
returns table (awarded boolean, seconds integer, previous_best integer, xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _today date := (now() at time zone _timezone)::date;
  _today_seconds integer;
  _best integer;
  _xp constant integer := 80;
  _inserted boolean := false;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  _today_seconds := public.prospecting_seconds_for_day(_today, _timezone);
  select coalesce(max(d.seconds), 0) into _best
  from public.prospecting_daily_seconds(_today - 400, _today - 1, _timezone) d;

  if _today_seconds > 0 and _today_seconds > _best then
    with ins as (
      insert into public.xp_events (user_id, kind, xp, idempotency_key)
      values (_uid, 'prospecting_record', _xp, _today::text)
      on conflict (user_id, kind, idempotency_key) do nothing
      returning 1
    )
    select exists (select 1 from ins) into _inserted;
  end if;

  return query
  select _inserted, _today_seconds, _best, case when _inserted then _xp else null end;
end;
$$;

revoke execute on function public.prospecting_record(text) from public, anon;
grant execute on function public.prospecting_record(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Tenth booked meeting: same idempotent shape, checked against calendar_events
-- (a meeting booked manually or from a contact move both count).
-- -----------------------------------------------------------------------------

create or replace function public.award_meeting_tenth()
returns table (awarded boolean, meetings integer, xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _meetings integer;
  _xp constant integer := 120;
  _inserted boolean := false;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into _meetings
  from public.calendar_events
  where user_id = _uid and kind = 'meeting';

  if _meetings >= 10 then
    with ins as (
      insert into public.xp_events (user_id, kind, xp, idempotency_key)
      values (_uid, 'meeting_tenth', _xp, 'tenth')
      on conflict (user_id, kind, idempotency_key) do nothing
      returning 1
    )
    select exists (select 1 from ins) into _inserted;
  end if;

  return query select _inserted, _meetings, case when _inserted then _xp else null end;
end;
$$;

revoke execute on function public.award_meeting_tenth() from public, anon;
grant execute on function public.award_meeting_tenth() to authenticated;

-- -----------------------------------------------------------------------------
-- Section unlocks: Cold Calling at 5 contacts, Calendar at the first meeting,
-- Finance at the first won deal, Workers at the third. Reuses the unlocks
-- table (key, unlocked_at, seen_at) that best_industries already writes to;
-- the client only ever updates seen_at.
-- -----------------------------------------------------------------------------

create or replace function public.section_unlocks()
returns table (key text, unlocked boolean, unlocked_at timestamptz, seen_at timestamptz, progress integer, needed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _contacts integer;
  _meetings integer;
  _deals_won integer;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into _contacts from public.contacts where user_id = _uid;
  select count(*)::integer into _meetings
    from public.calendar_events where user_id = _uid and kind = 'meeting';
  select count(*)::integer into _deals_won
    from public.deals d
    join public.pipeline_stages s on s.id = d.stage_id
    where d.user_id = _uid and s.is_won;

  if _contacts >= 5 then
    insert into public.unlocks (user_id, key) values (_uid, 'section_cold_calling')
    on conflict (user_id, key) do nothing;
  end if;
  if _meetings >= 1 then
    insert into public.unlocks (user_id, key) values (_uid, 'section_calendar')
    on conflict (user_id, key) do nothing;
  end if;
  if _deals_won >= 1 then
    insert into public.unlocks (user_id, key) values (_uid, 'section_finance')
    on conflict (user_id, key) do nothing;
  end if;
  if _deals_won >= 3 then
    insert into public.unlocks (user_id, key) values (_uid, 'section_workers')
    on conflict (user_id, key) do nothing;
  end if;

  return query
  select v.key, (u.id is not null), u.unlocked_at, u.seen_at, v.progress, v.needed
  from (
    values
      ('section_cold_calling', _contacts, 5),
      ('section_calendar', _meetings, 1),
      ('section_finance', _deals_won, 1),
      ('section_workers', _deals_won, 3)
  ) as v(key, progress, needed)
  left join public.unlocks u on u.user_id = _uid and u.key = v.key;
end;
$$;

revoke execute on function public.section_unlocks() from public, anon;
grant execute on function public.section_unlocks() to authenticated;
