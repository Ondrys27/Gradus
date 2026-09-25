-- =============================================================================
-- Shared "best time to call" statistics
--   Rebuilt daily by the cron from the last 365 days of moves of every user.
--   A call attempt is a move out of Unreached or No answer; a meeting is such a
--   move into the meeting_scheduled table. Day and hour are the caller's local
--   time, the country is the contact's (else the caller's).
--   One account counts at most 30 attempts per hour of a day, so nobody skews
--   the chart. The target table holds only country, weekday, hour and counts.
-- =============================================================================

create or replace function public.refresh_call_time_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rows integer;
begin
  delete from public.call_time_stats where true;

  insert into public.call_time_stats (country_code, day_of_week, hour, attempts, meetings)
  with attempts as (
    select
      m.user_id,
      upper(coalesce(c.country_code, s.country_code)) as country_code,
      (m.created_at at time zone s.timezone) as local_at,
      coalesce(t_to.system_key = 'meeting_scheduled', false) as meeting
    from public.contact_table_moves m
    join public.contact_tables t_from on t_from.id = m.from_table_id
    left join public.contact_tables t_to on t_to.id = m.to_table_id
    join public.user_settings s on s.user_id = m.user_id
    left join public.contacts c on c.id = m.contact_id
    where t_from.system_key in ('unreached', 'no_answer')
      and m.created_at >= now() - interval '365 days'
      and coalesce(c.country_code, s.country_code) is not null
  ),
  per_account as (
    select
      country_code,
      local_at::date as day,
      extract(hour from local_at)::smallint as hour,
      least(count(*), 30) as attempts,
      least(count(*) filter (where meeting), least(count(*), 30)) as meetings
    from attempts
    group by user_id, country_code, local_at::date, extract(hour from local_at)
  )
  select
    country_code,
    extract(dow from day)::smallint,
    hour,
    sum(attempts)::integer,
    sum(meetings)::integer
  from per_account
  group by country_code, extract(dow from day), hour;

  get diagnostics _rows = row_count;
  return _rows;
end;
$$;

-- Only the cron (service role) rebuilds the statistics.
revoke execute on function public.refresh_call_time_stats() from public, anon, authenticated;
grant execute on function public.refresh_call_time_stats() to service_role;
