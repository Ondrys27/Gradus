-- =============================================================================
-- Rewards: fixes after the review of 29.1
--   * reward_bonus_sync(): an earned bonus is taken back only when the
--     month's count falls under it (a reward of the rule undone). Before, a
--     rule switched off (or its bonus removed, or the person without a plan)
--     deleted the unpaid bonus of that month too, even an approved one: the
--     undo of any reward of an inactive rule and the daily cron (last month)
--     both did it. Now a rule that is off makes no new bonus and takes none
--     back.
-- Additive only (a function replaced).
-- =============================================================================

create or replace function public.reward_bonus_sync(_rule_id uuid, _at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rule public.reward_plan_rules;
  _plan public.reward_plans;
  _zone text;
  _month date;
  _source uuid;
  _bonus jsonb;
  _status text;
  _reached boolean;
begin
  select * into _rule from public.reward_plan_rules where id = _rule_id;
  if _rule.id is null or _rule.kind <> 'event' then
    return;
  end if;
  _bonus := _rule.definition -> 'limits' -> 'bonus';
  -- No bonus on the rule (any more): what it made stays as it is.
  if _bonus is null then
    return;
  end if;
  _zone := public.reward_zone(_rule.space_id);
  _month := date_trunc('month', _at at time zone _zone)::date;
  _source := md5(_rule.id::text || ':bonus:' || to_char(_month, 'YYYY-MM'))::uuid;
  _reached := public.reward_rule_count(_rule.id, _at, _rule.space_id) >= (_bonus ->> 'count')::integer;
  if not _reached then
    delete from public.reward_entries
    where source_kind = 'bonus' and source_id = _source and status <> 'paid'
      and corrects_id is null and reversed_at is null;
    return;
  end if;
  -- Reached: a new bonus only from an active rule of a plan that holds.
  _plan := public.reward_plan_for(_rule.worker_id, _at);
  if not _rule.active or _plan.id is null then
    return;
  end if;
  _status := public.reward_status_for(_plan);
  insert into public.reward_entries (
    space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
    status, occurred_at, approved_at
  ) values (
    _rule.space_id, _rule.worker_id, 'bonus', _source, _rule.id, 'event',
    (_bonus ->> 'amount')::numeric, _plan.currency, _status, _at,
    case when _status = 'approved' then now() end
  )
  on conflict do nothing;
end;
$$;
revoke execute on function public.reward_bonus_sync(uuid, timestamptz) from public, anon, authenticated;
