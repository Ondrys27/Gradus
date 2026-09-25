-- =============================================================================
-- Cold calling statistics, per calendar day in the user's zone
--   * seconds on the phone: segments clipped to each day, open ones ending at
--     their effective end (the idle rule applies when reading too)
--   * meetings: moves into the table with the system key meeting_scheduled
-- A range is capped at 400 days.
-- =============================================================================

create or replace function public.prospecting_daily_seconds(_from date, _to date, _timezone text)
returns table (day date, seconds integer)
language sql
stable
set search_path = ''
as $$
  with days as (
    select
      d::date as day,
      (d::date::timestamp at time zone _timezone) as day_start,
      ((d::date + 1)::timestamp at time zone _timezone) as day_end
    from generate_series(_from, least(_to, _from + 400), interval '1 day') d
  ),
  segments as (
    select s.started_at, public.prospecting_effective_end(s) as ended_at
    from public.prospecting_segments s
    where s.user_id = auth.uid()
      and s.started_at < (select max(day_end) from days)
      and coalesce(s.ended_at, now()) > (select min(day_start) from days)
  )
  select
    days.day,
    -- least/greatest skip NULLs, so days without a segment must be filtered out explicitly.
    coalesce(sum(extract(epoch from
      least(segments.ended_at, days.day_end) - greatest(segments.started_at, days.day_start)
    )) filter (where segments.started_at is not null), 0)::integer
  from days
  left join segments
    on segments.started_at < days.day_end and segments.ended_at > days.day_start
  group by days.day
  order by days.day;
$$;

create or replace function public.meetings_daily(_from date, _to date, _timezone text)
returns table (day date, meetings integer)
language sql
stable
set search_path = ''
as $$
  select (m.created_at at time zone _timezone)::date as day, count(*)::integer
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  where m.user_id = auth.uid()
    and t.system_key = 'meeting_scheduled'
    and m.created_at >= (_from::timestamp at time zone _timezone)
    and m.created_at < ((least(_to, _from + 400) + 1)::timestamp at time zone _timezone)
  group by 1
  order by 1;
$$;

revoke execute on function public.prospecting_daily_seconds(date, date, text),
  public.meetings_daily(date, date, text) from public, anon;
grant execute on function public.prospecting_daily_seconds(date, date, text),
  public.meetings_daily(date, date, text) to authenticated;
