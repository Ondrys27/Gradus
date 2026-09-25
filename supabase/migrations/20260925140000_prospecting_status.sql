-- =============================================================================
-- Prospecting timer status
--   Reading the timer applies the idle rule: an open segment whose effective
--   end (last move out of Unreached + 15 min) has passed is closed as idle right
--   there, and this one read reports it so the app can say so once.
--   Today's total is the day-clipped sum in the user's zone; nothing is stored.
-- =============================================================================

create or replace function public.prospecting_status(_timezone text)
returns table (
  running boolean,
  segment_started_at timestamptz,
  idle_deadline timestamptz,
  today_seconds integer,
  server_now timestamptz,
  idle_closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _open public.prospecting_segments;
  _effective timestamptz;
  _closed timestamptz;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into _open from public.prospecting_segments
  where user_id = _uid and ended_at is null;

  if _open.id is not null then
    _effective := public.prospecting_effective_end(_open);
    if _effective < now() then
      update public.prospecting_segments
        set ended_at = _effective, end_reason = 'idle'
        where id = _open.id;
      _closed := _effective;
      _open := null;
    end if;
  end if;

  return query
  select
    _open.id is not null,
    _open.started_at,
    case when _open.id is not null
      then public.prospecting_last_activity_at(_open) + public.timer_idle_interval()
    end,
    public.prospecting_seconds_for_day((now() at time zone _timezone)::date, _timezone),
    now(),
    _closed;
end;
$$;

revoke execute on function public.prospecting_status(text) from public, anon;
grant execute on function public.prospecting_status(text) to authenticated;
