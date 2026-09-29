-- =============================================================================
-- Onboarding
--   * profiles.industry is the branch the owner picked in step 2; it only
--     steers sample text on the client, nothing server-side depends on it
--   * profiles.onboarding_completed_at gates the wizard: null means show it,
--     set once and never cleared by the client
--   * award_xp() gets one more idempotent kind for the wizard's own XP
-- =============================================================================

alter table public.profiles
  add column industry text check (char_length(industry) <= 40),
  add column onboarding_completed_at timestamptz;

alter table public.xp_events drop constraint xp_events_kind_check;
alter table public.xp_events add constraint xp_events_kind_check check (kind in (
  'milestone_completed', 'deal_won', 'section_unlocked', 'prospecting_record',
  'contacts_generated_first', 'meeting_tenth', 'task_completed', 'contact_moved',
  'onboarding_completed'
));

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
    when 'onboarding_completed' then 40
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
