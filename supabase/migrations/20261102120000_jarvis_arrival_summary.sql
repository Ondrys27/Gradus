-- =============================================================================
-- Jarvis: the summary at the first arrival of the day and the new frequencies
-- (step 18.2)
--   * profiles.last_daily_brief_on: the day (in the user's zone) the summary
--     was last shown or settled with nothing to say. Written by /api/jarvis
--     only (admin client); profiles_summary_guard keeps the client out
--   * user_settings.jarvis_frequency: every_2h · every_6h · daily · weekly ·
--     monthly. The old values are mapped (often → every_2h, sometimes →
--     every_6h, briefing_only → daily), now and on every later write, so a
--     browser tab from before the change still saves
--   * jarvis_briefing_candidates(): the cron writes a summary only when it is
--     due by the frequency (every day; the week's first day; the month's
--     first day), not on the onboarding's day and not when the first arrival
--     already settled today
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The day the arrival summary was settled
-- -----------------------------------------------------------------------------

alter table public.profiles add column last_daily_brief_on date;

comment on column public.profiles.last_daily_brief_on is
  'The day (user''s zone) Jarvis last showed the arrival summary or found nothing to say; the next one comes in the next day, week or month. Server only.';

create or replace function public.profiles_summary_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and new.last_daily_brief_on is distinct from old.last_daily_brief_on then
    raise exception 'summary_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_summary_guard() from public, anon, authenticated;

create trigger profiles_summary_guard
  before update of last_daily_brief_on on public.profiles
  for each row execute function public.profiles_summary_guard();

-- -----------------------------------------------------------------------------
-- Frequencies
-- -----------------------------------------------------------------------------

alter table public.user_settings drop constraint if exists user_settings_jarvis_frequency_check;

update public.user_settings
set jarvis_frequency = case jarvis_frequency
  when 'often' then 'every_2h'
  when 'sometimes' then 'every_6h'
  when 'briefing_only' then 'daily'
end
where jarvis_frequency in ('often', 'sometimes', 'briefing_only');

alter table public.user_settings alter column jarvis_frequency set default 'every_6h';

alter table public.user_settings add constraint user_settings_jarvis_frequency_check
  check (jarvis_frequency in ('every_2h', 'every_6h', 'daily', 'weekly', 'monthly'));

-- An open tab from before the change still sends the old values; they mean the new ones.
create or replace function public.user_settings_jarvis_frequency_legacy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.jarvis_frequency := case new.jarvis_frequency
    when 'often' then 'every_2h'
    when 'sometimes' then 'every_6h'
    when 'briefing_only' then 'daily'
    else new.jarvis_frequency
  end;
  return new;
end;
$$;
revoke execute on function public.user_settings_jarvis_frequency_legacy() from public, anon, authenticated;

create trigger user_settings_jarvis_frequency_legacy
  before insert or update of jarvis_frequency on public.user_settings
  for each row execute function public.user_settings_jarvis_frequency_legacy();

-- -----------------------------------------------------------------------------
-- Brief candidates (server only), by frequency
-- -----------------------------------------------------------------------------

-- Users whose brief is due: between 6 and 11 a.m. in their zone, proactive
-- Jarvis on, onboarding done before today, the brief unlocked (level 5 in
-- game mode, always in tool mode), due today by the frequency (weekly: the
-- week's first day by first_day_of_week, 0 = Sunday; monthly: the 1st), not
-- settled at an arrival today, no brief yet today and some activity in the
-- last week.
create or replace function public.jarvis_briefing_candidates(_now timestamptz, _limit integer)
returns table (user_id uuid)
language sql
stable
set search_path = ''
as $$
  with zones as materialized (
    select z.name from pg_catalog.pg_timezone_names z
  ),
  -- Materialized: the zone is checked before `at time zone` can fail on it.
  enabled as materialized (
    select s.user_id, s.timezone, s.jarvis_frequency, s.first_day_of_week,
           p.onboarding_completed_at, p.last_daily_brief_on
    from public.user_settings s
    join public.profiles p on p.id = s.user_id
    where s.jarvis_proactive
      and p.onboarding_completed_at is not null
      and s.timezone in (select name from zones)
      and (
        p.mode = 'tool'
        or exists (
          select 1 from public.unlocks u
          where u.user_id = s.user_id and u.key = 'jarvis_morning_brief'
        )
      )
  ),
  local as materialized (
    select e.*, (_now at time zone e.timezone) as local_now from enabled e
  )
  select l.user_id
  from local l
  where extract(hour from l.local_now) between 6 and 10
    -- A new account has its welcome; the first summary comes the next day.
    and (l.onboarding_completed_at at time zone l.timezone)::date < l.local_now::date
    and (l.last_daily_brief_on is null or l.last_daily_brief_on < l.local_now::date)
    and case l.jarvis_frequency
      when 'weekly' then extract(dow from l.local_now) = l.first_day_of_week
      when 'monthly' then extract(day from l.local_now) = 1
      else true
    end
    and not exists (
      select 1 from public.jarvis_suggestions j
      where j.user_id = l.user_id
        and j.dedupe_key = 'briefing:' || to_char(l.local_now, 'YYYY-MM-DD')
    )
    and (
      exists (select 1 from public.deals d where d.user_id = l.user_id and d.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.tasks t where t.user_id = l.user_id and t.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.milestones m where m.user_id = l.user_id and m.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.contact_table_moves c where c.user_id = l.user_id and c.created_at >= _now - interval '7 days')
      or exists (select 1 from public.calendar_events c where c.user_id = l.user_id and c.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.crm_tasks c where c.user_id = l.user_id and c.updated_at >= _now - interval '7 days')
    )
  order by l.user_id
  limit greatest(_limit, 0);
$$;
revoke execute on function public.jarvis_briefing_candidates(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.jarvis_briefing_candidates(timestamptz, integer) to service_role;
