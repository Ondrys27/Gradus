-- =============================================================================
-- Review K9: tool mode locks nothing; level rewards backfilled
--   "Best industries" waited for 10 booked meetings in every mode. In tool mode
--   (and for a worker, who has no game of their own) it is open from the start:
--   the list is returned at once and nothing is celebrated as newly unlocked.
--   In game mode the rule is unchanged.
-- =============================================================================

create or replace function public.industry_insights()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _ws uuid := public.current_workspace_id();
  _needed constant integer := 10;
  _meetings integer;
  _unlock public.unlocks;
  _open boolean;
  _industries jsonb := '[]'::jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not (public.has_section_access(_ws, 'cold_calling', 'view')
          or public.has_section_access(_ws, 'contacts', 'view')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into _meetings
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  where m.user_id = _ws and t.system_key = 'meeting_scheduled';

  if _meetings >= _needed then
    insert into public.unlocks (user_id, key) values (_uid, 'best_industries')
    on conflict (user_id, key) do nothing;
  end if;
  select * into _unlock from public.unlocks where user_id = _uid and key = 'best_industries';

  -- Tool mode and a worker: open without the game's threshold.
  _open := _unlock.id is not null
    or _ws is distinct from _uid
    or coalesce((select p.mode from public.profiles p where p.id = _uid), 'game') = 'tool';

  if _open then
    select coalesce(jsonb_agg(row_to_json(r) order by r.meetings::numeric / greatest(r.called, 1) desc, r.called desc), '[]'::jsonb)
    into _industries
    from (
      select
        min(c.generated_industry) as industry,
        count(*)::integer as contacts,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.from_table_id
          where m.contact_id = c.id and t.system_key = 'unreached'
        ))::integer as called,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.to_table_id
          where m.contact_id = c.id and t.system_key = 'meeting_scheduled'
        ))::integer as meetings
      from public.contacts c
      where c.user_id = _ws and c.generated_industry is not null
      group by lower(c.generated_industry)
      limit 50
    ) r;
  end if;

  return jsonb_build_object(
    'meetings', _meetings,
    'needed', _needed,
    -- Open without an unlock row: shown as unlocked and already seen, so the
    -- app neither locks the card nor celebrates it.
    'unlocked_at', case when _open then coalesce(_unlock.unlocked_at, now()) end,
    'seen_at', case when _unlock.id is not null then _unlock.seen_at when _open then now() end,
    'industries', _industries
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Level rewards of accounts that reached a level before award_xp() granted
-- them: game_state() shows them unlocked by level, but the morning brief cron
-- and the server read the unlocks table. Already seen, so nothing glows.
-- -----------------------------------------------------------------------------

insert into public.unlocks (user_id, key, seen_at)
select x.user_id, r.unlock_key, now()
from (
  select e.user_id, public.game_level_for_xp(sum(e.xp)::bigint) as level
  from public.xp_events e
  group by e.user_id
) x
join public.level_rewards r on r.level <= x.level
on conflict (user_id, key) do nothing;
