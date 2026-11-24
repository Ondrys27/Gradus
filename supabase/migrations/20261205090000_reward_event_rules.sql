-- =============================================================================
-- Rewards: rules with any trigger, set by a sentence (step 29.1)
--   * reward_plan_rules.definition: a rule is { event, conditions, reward,
--     limits, stack, undo } (kind = 'event'); reward_definition_ok() checks it
--     the same way as definitionSchema / definitionErrors() in
--     src/features/workers/rewards/definition.ts. Events (catalog.ts):
--     contact.moved (from: any | only | except tables, to: any | only tables),
--     meeting.booked (calls | scheduler | calendar), meeting.held,
--     booking.received, call.logged, contact.created (with phone / e-mail),
--     deal.moved (stages), deal.won, deal.lost, task.done (on time, kinds, the
--     task's own price), milestone.done, invoice.issued, invoice.paid,
--     time.hour, time.month. Conditions: who (self = the worker did it,
--     record = the worker is on the record), value from–to in the plan's
--     currency, contact tags, only the first time per contact / deal (on by
--     default), dates. Reward: fixed, percent of the value, per unit (hour),
--     tiers by the count in the month, the task's price; a monthly cap and a
--     bonus at a count. Two rules on one event add up ("sum") or only the
--     highest pays ("max").
--   * The kinds of 28.2 become rules with the same behaviour
--     (reward_legacy_definition(), = legacyDefinition() in TypeScript): every
--     row is converted here, and a client that still writes an old kind gets
--     it converted by the guard. Their entries keep their ids; rule_kind of
--     an entry of a converted rule becomes 'event', so the engine matches it.
--     per_meeting paid a move into the system table "Meeting scheduled" from
--     any table (once per contact, a move back kept it) and a booking
--     confirmed in the scheduler; per_call a move out of "Not contacted" or
--     "No answer"; per_contact a first move into "Interested" or "Meeting
--     scheduled". All three stay exactly that (moving back keeps the reward:
--     undo = 'keep').
--   * reward_entries.subject_id + once: the contact or deal "only the first
--     time" counts on; a unique index holds it (a rule pays a contact once
--     while that reward stands). Moving back out of the rule's "to" tables
--     (or stages) cancels the latest reward of that contact or deal unless
--     it is paid (undo = 'cancel', the default of a new rule).
--   * Tiers and bonuses count the rule's rewards in the month of the space;
--     the daily cron recomputes last month's tiers (unpaid rewards) and its
--     bonus once the month has ended, without duplicates (one bonus per rule
--     and month, a fixed source id).
--   * contacts.created_by: who made a contact (the session's, guarded).
--   * reward_history(): the worker's events of the last days as the engine
--     sees them, for "Try it" (a dry run in TypeScript, nothing is written);
--     reward_plan_refs(): the space's tables and stages by id and name for
--     whoever reads the plan.
-- Additive only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------

alter table public.reward_plan_rules add column if not exists definition jsonb;
alter table public.reward_entries add column if not exists subject_id uuid;
alter table public.reward_entries add column if not exists once boolean not null default false;
alter table public.contacts add column if not exists created_by uuid default auth.uid()
  references auth.users (id) on delete set null;

-- Who made a contact is the session's: a client never names somebody else.
create or replace function public.contacts_created_by_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  elsif public.is_client_request() then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke execute on function public.contacts_created_by_guard() from public, anon, authenticated;
drop trigger if exists contacts_created_by_guard on public.contacts;
create trigger contacts_created_by_guard
  before insert or update on public.contacts
  for each row execute function public.contacts_created_by_guard();

alter type public.reward_wish add attribute subject_id uuid, add attribute once boolean;

alter table public.reward_entries drop constraint if exists reward_entries_source_kind_check;
alter table public.reward_entries add constraint reward_entries_source_kind_check check (source_kind in (
  'crm_task', 'worker_task', 'task', 'milestone', 'deal', 'meeting', 'booking', 'call',
  'contact', 'work_session', 'month', 'manual',
  'contact_move', 'deal_event', 'calendar_event', 'activity', 'invoice', 'bonus'));
alter table public.reward_entries drop constraint if exists reward_entries_rule_kind_check;
alter table public.reward_entries add constraint reward_entries_rule_kind_check check (rule_kind in (
  'task_fixed', 'task_default', 'project_done', 'per_meeting', 'per_call', 'per_contact',
  'deal_percent', 'deal_fixed', 'hourly', 'monthly_fixed', 'price', 'manual', 'event'));

-- -----------------------------------------------------------------------------
-- 2. The definition
-- -----------------------------------------------------------------------------

-- The default "who" of an event (EVENT_CATALOG[...].who[0]).
create or replace function public.reward_default_who(_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when _event in ('deal.won', 'deal.lost', 'task.done', 'milestone.done') then 'record' else 'self' end;
$$;

-- "Only the first time" (on by default) where the event has a contact or a deal to count it on.
create or replace function public.reward_rule_once(_d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _d -> 'event' ->> 'key' in ('contact.moved', 'meeting.booked', 'call.logged', 'deal.moved')
    and coalesce((_d -> 'conditions' ->> 'once')::boolean, true);
$$;

-- One side of a move: { mode, ids } with ids of tables or stages (uuids).
create or replace function public.reward_side_ok(_s jsonb, _modes text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _k text;
begin
  if _s is null then
    return true;
  end if;
  if jsonb_typeof(_s) <> 'object' or jsonb_typeof(_s -> 'ids') is distinct from 'array'
     or not (_s ->> 'mode' = any (_modes)) or jsonb_array_length(_s -> 'ids') > 50 then
    return false;
  end if;
  for _k in select jsonb_object_keys(_s) loop
    if _k not in ('mode', 'ids') then
      return false;
    end if;
  end loop;
  return not exists (
    select 1 from jsonb_array_elements(_s -> 'ids') i
    where jsonb_typeof(i) <> 'string'
       or not (i #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );
end;
$$;

create or replace function public.reward_money_ok(_v jsonb, _max numeric, _zero boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _v is not null and jsonb_typeof(_v) = 'number'
    and (case when _zero then (_v #>> '{}')::numeric >= 0 else (_v #>> '{}')::numeric > 0 end)
    and (_v #>> '{}')::numeric <= _max
    and (_v #>> '{}')::numeric = round((_v #>> '{}')::numeric, 2);
$$;

-- The same checks as definitionErrors() (an empty list of tables is allowed
-- here: a converted rule of a space without the system table never pays).
create or replace function public.reward_definition_ok(_d jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _e jsonb;
  _c jsonb;
  _r jsonb;
  _l jsonb;
  _key text;
  _k text;
  _type text;
  _move boolean;
  _value boolean;
  _tags boolean;
  _once boolean;
  _counted boolean;
  _cap boolean;
  _rewards text[];
  _who text[];
  _vias text[];
  _prev integer := 0;
  _t jsonb;
  _day text;
begin
  if _d is null or jsonb_typeof(_d) <> 'object' then
    return false;
  end if;
  for _k in select jsonb_object_keys(_d) loop
    if _k not in ('event', 'conditions', 'reward', 'limits', 'stack', 'undo') then
      return false;
    end if;
  end loop;
  _e := _d -> 'event';
  _c := coalesce(_d -> 'conditions', '{}'::jsonb);
  _r := _d -> 'reward';
  _l := coalesce(_d -> 'limits', '{}'::jsonb);
  if jsonb_typeof(_e) is distinct from 'object' or jsonb_typeof(_r) is distinct from 'object'
     or jsonb_typeof(_c) <> 'object' or jsonb_typeof(_l) <> 'object' then
    return false;
  end if;
  if coalesce(_d ->> 'stack', 'sum') not in ('sum', 'max') or coalesce(_d ->> 'undo', 'cancel') not in ('cancel', 'keep') then
    return false;
  end if;

  _key := _e ->> 'key';
  _move := false; _value := false; _tags := true; _once := false; _counted := true; _cap := true;
  _who := array['self'];
  _rewards := array['fixed', 'tiers'];
  case _key
    when 'contact.moved' then _move := true; _once := true;
    when 'meeting.booked' then _once := true; _vias := array['calls', 'scheduler', 'calendar'];
    when 'meeting.held' then _vias := array['scheduler', 'calendar'];
    when 'booking.received' then null;
    when 'call.logged' then _once := true;
    when 'contact.created' then null;
    when 'deal.moved' then _move := true; _value := true; _once := true;
      _who := array['self', 'record']; _rewards := array['fixed', 'percent', 'tiers'];
    when 'deal.won' then _value := true; _who := array['record', 'self']; _rewards := array['fixed', 'percent', 'tiers'];
    when 'deal.lost' then _value := true; _who := array['record', 'self'];
    when 'task.done' then _who := array['record', 'self']; _rewards := array['fixed', 'tiers', 'price'];
    when 'milestone.done' then _who := array['record']; _tags := false;
    when 'invoice.issued', 'invoice.paid' then _value := true; _who := array['self', 'record'];
      _rewards := array['fixed', 'percent', 'tiers'];
    when 'time.hour' then _tags := false; _counted := false; _rewards := array['unit'];
    when 'time.month' then _tags := false; _counted := false; _cap := false; _rewards := array['fixed'];
    else return false;
  end case;

  -- The event's own parameters.
  for _k in select jsonb_object_keys(_e) loop
    if _k not in ('key', 'from', 'to', 'via', 'onTime', 'taskKinds', 'require') then
      return false;
    end if;
  end loop;
  if (_e ? 'from' or _e ? 'to') and not _move then
    return false;
  end if;
  if not public.reward_side_ok(_e -> 'from', array['any', 'only', 'except'])
     or not public.reward_side_ok(_e -> 'to', array['any', 'only']) then
    return false;
  end if;
  if _e ? 'via' then
    if _vias is null or jsonb_typeof(_e -> 'via') <> 'array' or jsonb_array_length(_e -> 'via') not between 1 and 3
       or exists (select 1 from jsonb_array_elements_text(_e -> 'via') v where not (v = any (_vias))) then
      return false;
    end if;
  end if;
  if _e ? 'onTime' and (_key <> 'task.done' or jsonb_typeof(_e -> 'onTime') <> 'boolean') then
    return false;
  end if;
  if _e ? 'taskKinds' then
    if _key <> 'task.done' or jsonb_typeof(_e -> 'taskKinds') <> 'array' or jsonb_array_length(_e -> 'taskKinds') > 3
       or exists (select 1 from jsonb_array_elements_text(_e -> 'taskKinds') v
                  where v not in ('crm_task', 'worker_task', 'task')) then
      return false;
    end if;
  end if;
  if _e ? 'require' and (_key <> 'contact.created'
     or coalesce(_e ->> 'require', '') not in ('none', 'phone', 'email', 'phone_or_email')) then
    return false;
  end if;

  -- Conditions.
  for _k in select jsonb_object_keys(_c) loop
    if _k not in ('who', 'value', 'tags', 'once', 'window') then
      return false;
    end if;
  end loop;
  if _c ? 'who' and not (coalesce(_c ->> 'who', '') = any (_who)) then
    return false;
  end if;
  if _c ? 'value' then
    if not _value or jsonb_typeof(_c -> 'value') <> 'object' then
      return false;
    end if;
    for _k in select jsonb_object_keys(_c -> 'value') loop
      if _k not in ('min', 'max') then
        return false;
      end if;
    end loop;
    if (_c -> 'value' ? 'min' and not public.reward_money_ok(_c -> 'value' -> 'min', 1000000000, true))
       or (_c -> 'value' ? 'max' and not public.reward_money_ok(_c -> 'value' -> 'max', 1000000000))
       or ((_c -> 'value' ->> 'max')::numeric < (_c -> 'value' ->> 'min')::numeric) then
      return false;
    end if;
  end if;
  if _c ? 'tags' then
    if not _tags or jsonb_typeof(_c -> 'tags') <> 'array' or jsonb_array_length(_c -> 'tags') > 10
       or exists (select 1 from jsonb_array_elements(_c -> 'tags') t
                  where jsonb_typeof(t) <> 'string' or char_length(t #>> '{}') not between 1 and 50) then
      return false;
    end if;
  end if;
  if _c ? 'once' and (not _once or jsonb_typeof(_c -> 'once') <> 'boolean') then
    return false;
  end if;
  if _c ? 'window' then
    if jsonb_typeof(_c -> 'window') <> 'object' then
      return false;
    end if;
    for _k in select jsonb_object_keys(_c -> 'window') loop
      if _k not in ('from', 'to') then
        return false;
      end if;
      _day := _c -> 'window' ->> _k;
      if _day is null or _day !~ '^\d{4}-\d{2}-\d{2}$' then
        return false;
      end if;
    end loop;
    if _c -> 'window' ? 'from' and _c -> 'window' ? 'to'
       and (_c -> 'window' ->> 'to') < (_c -> 'window' ->> 'from') then
      return false;
    end if;
  end if;

  -- The reward.
  _type := _r ->> 'type';
  if _type is null or not (_type = any (_rewards)) then
    return false;
  end if;
  for _k in select jsonb_object_keys(_r) loop
    if _k <> 'type' and _k <> (case _type
         when 'percent' then 'percent' when 'tiers' then 'tiers' when 'price' then '' else 'amount' end) then
      return false;
    end if;
  end loop;
  if _type in ('fixed', 'unit') and not public.reward_money_ok(_r -> 'amount', 10000000) then
    return false;
  end if;
  if _type = 'percent' and not public.reward_money_ok(_r -> 'percent', 100) then
    return false;
  end if;
  if _type = 'tiers' then
    if jsonb_typeof(_r -> 'tiers') <> 'array' or jsonb_array_length(_r -> 'tiers') not between 2 and 10
       or (_r -> 'tiers' -> 0 ->> 'from') is distinct from '1' then
      return false;
    end if;
    for _t in select value from jsonb_array_elements(_r -> 'tiers') loop
      if jsonb_typeof(_t) <> 'object' or jsonb_typeof(_t -> 'from') <> 'number'
         or (_t ->> 'from')::numeric <> trunc((_t ->> 'from')::numeric)
         or (_t ->> 'from')::numeric > 10000 or (_t ->> 'from')::integer <= _prev
         or not public.reward_money_ok(_t -> 'amount', 10000000)
         or exists (select 1 from jsonb_object_keys(_t) k where k not in ('from', 'amount')) then
        return false;
      end if;
      _prev := (_t ->> 'from')::integer;
    end loop;
  end if;

  -- Limits.
  for _k in select jsonb_object_keys(_l) loop
    if _k not in ('cap', 'bonus') then
      return false;
    end if;
  end loop;
  if _l ? 'cap' and (not _cap or not public.reward_money_ok(_l -> 'cap', 100000000)) then
    return false;
  end if;
  if _l ? 'bonus' then
    if not _counted or jsonb_typeof(_l -> 'bonus') <> 'object'
       or jsonb_typeof(_l -> 'bonus' -> 'count') <> 'number'
       or (_l -> 'bonus' ->> 'count')::numeric <> trunc((_l -> 'bonus' ->> 'count')::numeric)
       or (_l -> 'bonus' ->> 'count')::numeric not between 1 and 1000
       or not public.reward_money_ok(_l -> 'bonus' -> 'amount', 10000000)
       or exists (select 1 from jsonb_object_keys(_l -> 'bonus') k where k not in ('count', 'amount')) then
      return false;
    end if;
  end if;
  return true;
end;
$$;

-- A rule of 28.2 as a definition that pays the same events (legacyDefinition() in TypeScript).
create or replace function public.reward_legacy_definition(
  _kind text,
  _amount numeric,
  _percent numeric,
  _filter jsonb,
  _cap numeric,
  _space uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _limits jsonb := case when _cap is null then '{}'::jsonb else jsonb_build_object('cap', _cap) end;
  _on_time boolean := coalesce((_filter ->> 'onTimeOnly')::boolean, false);
  _min jsonb := case when _filter ? 'minDealValue'
    then jsonb_build_object('value', jsonb_build_object('min', (_filter ->> 'minDealValue')::numeric))
    else '{}'::jsonb end;
  _fixed jsonb := jsonb_build_object('type', 'fixed', 'amount', _amount);
  _task jsonb := jsonb_build_object('key', 'task.done')
    || case when _on_time then '{"onTime": true}'::jsonb else '{}'::jsonb end;
  _ids jsonb;
begin
  return case _kind
    when 'task_fixed' then jsonb_build_object('event', _task, 'conditions', '{}'::jsonb,
      'reward', '{"type": "price"}'::jsonb, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'task_default' then jsonb_build_object('event', _task, 'conditions', '{}'::jsonb,
      'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'project_done' then jsonb_build_object('event', '{"key": "milestone.done"}'::jsonb,
      'conditions', '{}'::jsonb, 'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'per_meeting' then jsonb_build_object(
      'event', '{"key": "meeting.booked", "via": ["calls", "scheduler"]}'::jsonb,
      'conditions', '{"once": true}'::jsonb, 'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'per_call' then jsonb_build_object(
      'event', jsonb_build_object('key', 'contact.moved',
        'from', jsonb_build_object('mode', 'only', 'ids', coalesce((
          select jsonb_agg(t.id order by t.position) from public.contact_tables t
          where t.user_id = _space and t.system_key in ('unreached', 'no_answer')), '[]'::jsonb)),
        'to', '{"mode": "any", "ids": []}'::jsonb),
      'conditions', '{"once": false}'::jsonb, 'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'per_contact' then jsonb_build_object(
      'event', jsonb_build_object('key', 'contact.moved',
        'from', '{"mode": "any", "ids": []}'::jsonb,
        'to', jsonb_build_object('mode', 'only', 'ids', coalesce((
          select jsonb_agg(t.id order by t.position) from public.contact_tables t
          where t.user_id = _space and t.system_key in ('interested', 'meeting_scheduled')), '[]'::jsonb))),
      'conditions', '{"once": true}'::jsonb, 'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'deal_percent' then jsonb_build_object('event', '{"key": "deal.won"}'::jsonb, 'conditions', _min,
      'reward', jsonb_build_object('type', 'percent', 'percent', _percent), 'limits', _limits,
      'stack', 'sum', 'undo', 'keep')
    when 'deal_fixed' then jsonb_build_object('event', '{"key": "deal.won"}'::jsonb, 'conditions', _min,
      'reward', _fixed, 'limits', _limits, 'stack', 'sum', 'undo', 'keep')
    when 'hourly' then jsonb_build_object('event', '{"key": "time.hour"}'::jsonb, 'conditions', '{}'::jsonb,
      'reward', jsonb_build_object('type', 'unit', 'amount', _amount), 'limits', _limits,
      'stack', 'sum', 'undo', 'keep')
    when 'monthly_fixed' then jsonb_build_object('event', '{"key": "time.month"}'::jsonb,
      'conditions', '{}'::jsonb, 'reward', _fixed, 'limits', '{}'::jsonb, 'stack', 'sum', 'undo', 'keep')
  end;
end;
$$;
revoke execute on function public.reward_legacy_definition(text, numeric, numeric, jsonb, numeric, uuid)
  from public, anon, authenticated;

-- An event rule keeps everything in its definition; the old columns stay empty.
create or replace function public.reward_rule_ok(
  _kind text,
  _amount numeric,
  _percent numeric,
  _filter jsonb,
  _cap numeric
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _key text;
begin
  if _kind = 'event' then
    return _amount is null and _percent is null and _cap is null and _filter = '{}'::jsonb;
  end if;
  if _kind is null or _kind not in (
    'task_fixed', 'task_default', 'project_done', 'per_meeting', 'per_call', 'per_contact',
    'deal_percent', 'deal_fixed', 'hourly', 'monthly_fixed') then
    return false;
  end if;
  if _filter is null or jsonb_typeof(_filter) <> 'object' then
    return false;
  end if;
  for _key in select jsonb_object_keys(_filter) loop
    if _key not in ('onTimeOnly', 'minDealValue') then
      return false;
    end if;
  end loop;
  if _filter ? 'onTimeOnly' then
    if _kind not in ('task_fixed', 'task_default') or jsonb_typeof(_filter -> 'onTimeOnly') <> 'boolean' then
      return false;
    end if;
  end if;
  if _filter ? 'minDealValue' then
    if _kind not in ('deal_fixed', 'deal_percent') or jsonb_typeof(_filter -> 'minDealValue') <> 'number' then
      return false;
    end if;
    if (_filter ->> 'minDealValue')::numeric < 0 or (_filter ->> 'minDealValue')::numeric > 1000000000 then
      return false;
    end if;
  end if;
  if _cap is not null and (_cap <= 0 or _cap > 100000000 or _kind = 'monthly_fixed') then
    return false;
  end if;
  if _kind = 'task_fixed' then
    return _amount is null and _percent is null;
  end if;
  if _kind = 'deal_percent' then
    return _amount is null and _percent is not null and _percent > 0 and _percent <= 100;
  end if;
  return _percent is null and _amount is not null and _amount > 0 and _amount <= 10000000;
end;
$$;

-- A rule takes its space and worker from its plan; an old kind becomes an
-- event rule; the unit follows the reward; a plan holds 30 rules at most.
create or replace function public.reward_plan_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
begin
  if tg_op = 'UPDATE' then
    new.plan_id := old.plan_id;
  end if;
  select * into _plan from public.reward_plans where id = new.plan_id;
  -- An unknown plan: row level security and the foreign key refuse the row.
  if _plan.id is null then
    return new;
  end if;
  new.space_id := _plan.space_id;
  new.worker_id := _plan.worker_id;
  if new.kind is distinct from 'event' and public.reward_rule_ok(new.kind, new.amount, new.percent, new.filter, new.cap_per_period) then
    new.definition := public.reward_legacy_definition(new.kind, new.amount, new.percent, new.filter,
      new.cap_per_period, _plan.space_id);
    new.kind := 'event';
    new.amount := null;
    new.percent := null;
    new.filter := '{}'::jsonb;
    new.cap_per_period := null;
  end if;
  new.unit := case
    when new.definition -> 'reward' ->> 'type' = 'unit' then 'hour'
    when new.definition -> 'event' ->> 'key' = 'time.month' then 'month'
    when new.definition -> 'reward' ->> 'type' = 'percent' then 'percent'
    when new.definition -> 'reward' ->> 'type' = 'price' then 'price'
    else 'item'
  end;
  if tg_op = 'INSERT' and (
    select count(*) from public.reward_plan_rules r where r.plan_id = new.plan_id
  ) >= 30 then
    raise exception 'reward_rules_limit' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.reward_plan_rules_guard() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Existing rules and their entries become the general shape
-- -----------------------------------------------------------------------------

-- Meetings and contacts were once per contact: the new index counts on the contact.
update public.reward_entries e
set subject_id = e.source_id, once = true
where e.rule_id is not null
  and ((e.rule_kind = 'per_contact' and e.source_kind = 'contact')
    or (e.rule_kind = 'per_meeting' and e.source_kind = 'meeting'));
update public.reward_entries e
set rule_kind = 'event'
where e.rule_id is not null
  and e.rule_kind in ('task_fixed', 'task_default', 'project_done', 'per_meeting', 'per_call',
                      'per_contact', 'deal_percent', 'deal_fixed', 'hourly', 'monthly_fixed');
-- The guard converts each row (the resync trigger of 28.2 only reacts to task_fixed).
update public.reward_plan_rules set kind = kind where kind <> 'event';

alter table public.reward_plan_rules drop constraint if exists reward_plan_rules_definition_ok;
alter table public.reward_plan_rules add constraint reward_plan_rules_definition_ok
  check (kind <> 'event' or public.reward_definition_ok(definition));
create index if not exists reward_plan_rules_event_idx
  on public.reward_plan_rules (space_id, ((definition -> 'event' ->> 'key'))) where kind = 'event';

-- "Only the first time": one standing reward per rule and contact (or deal).
create unique index if not exists reward_entries_once_idx on public.reward_entries (rule_id, subject_id)
  where once and rule_id is not null and subject_id is not null
    and corrects_id is null and reversed_at is null;
create index if not exists reward_entries_subject_idx on public.reward_entries (rule_id, subject_id, occurred_at desc)
  where subject_id is not null;

-- -----------------------------------------------------------------------------
-- 4. The engine
-- -----------------------------------------------------------------------------

-- All conditions of a rule hold for the event (ruleMatches() in evaluate.ts).
create or replace function public.reward_rule_matches(_d jsonb, _s jsonb, _plan_currency text, _zone text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  _e jsonb := _d -> 'event';
  _c jsonb := coalesce(_d -> 'conditions', '{}'::jsonb);
  _who text;
  _mode text;
  _v numeric;
  _day date;
begin
  if _e ->> 'key' is distinct from _s ->> 'event' or coalesce((_s ->> 'undo')::boolean, false) then
    return false;
  end if;
  _who := coalesce(_c ->> 'who', public.reward_default_who(_e ->> 'key'));
  if _who = 'self' and not coalesce((_s ->> 'did')::boolean, false) then
    return false;
  end if;
  if _who = 'record' and not coalesce((_s ->> 'on_record')::boolean, false) then
    return false;
  end if;

  _mode := _e -> 'from' ->> 'mode';
  if _mode = 'only' and not coalesce((_e -> 'from' -> 'ids') ? (_s ->> 'from_id'), false) then
    return false;
  end if;
  if _mode = 'except' and coalesce((_e -> 'from' -> 'ids') ? (_s ->> 'from_id'), false) then
    return false;
  end if;
  if _e -> 'to' ->> 'mode' = 'only' and not coalesce((_e -> 'to' -> 'ids') ? (_s ->> 'to_id'), false) then
    return false;
  end if;
  if _e ? 'via' and _s ->> 'via' is not null and not ((_e -> 'via') ? (_s ->> 'via')) then
    return false;
  end if;
  if coalesce((_e ->> 'onTime')::boolean, false) and (_s ->> 'on_time')::boolean is false then
    return false;
  end if;
  if jsonb_array_length(coalesce(_e -> 'taskKinds', '[]'::jsonb)) > 0
     and not coalesce((_e -> 'taskKinds') ? (_s ->> 'task_kind'), false) then
    return false;
  end if;
  if (_s ->> 'priced') is not null
     and ((_d -> 'reward' ->> 'type') = 'price') <> (_s ->> 'priced')::boolean then
    return false;
  end if;
  if coalesce(_e ->> 'require', 'none') <> 'none' then
    if not (case _e ->> 'require'
      when 'phone' then coalesce((_s ->> 'has_phone')::boolean, false)
      when 'email' then coalesce((_s ->> 'has_email')::boolean, false)
      else coalesce((_s ->> 'has_phone')::boolean, false) or coalesce((_s ->> 'has_email')::boolean, false)
    end) then
      return false;
    end if;
  end if;
  if coalesce(_c -> 'value' ? 'min', false) or coalesce(_c -> 'value' ? 'max', false) then
    -- A range in the plan's currency compares only an amount in the same currency.
    if _s ->> 'currency' is distinct from _plan_currency then
      return false;
    end if;
    _v := coalesce((_s ->> 'value')::numeric, 0);
    if _c -> 'value' ? 'min' and _v < (_c -> 'value' ->> 'min')::numeric then
      return false;
    end if;
    if _c -> 'value' ? 'max' and _v > (_c -> 'value' ->> 'max')::numeric then
      return false;
    end if;
  end if;
  if jsonb_array_length(coalesce(_c -> 'tags', '[]'::jsonb)) > 0 and not exists (
    select 1
    from jsonb_array_elements_text(_c -> 'tags') wanted (tag)
    join jsonb_array_elements_text(case when jsonb_typeof(_s -> 'tags') = 'array' then _s -> 'tags' else '[]'::jsonb end) had (tag)
      on lower(had.tag) = lower(wanted.tag)
  ) then
    return false;
  end if;
  if _c ? 'window' then
    _day := ((_s ->> 'at')::timestamptz at time zone _zone)::date;
    if _c -> 'window' ? 'from' and _day < (_c -> 'window' ->> 'from')::date then
      return false;
    end if;
    if _c -> 'window' ? 'to' and _day > (_c -> 'window' ->> 'to')::date then
      return false;
    end if;
  end if;
  return true;
end;
$$;

-- How many rewards a rule made in the month of `_at` (tiers, bonuses; bonuses themselves aside).
create or replace function public.reward_rule_count(_rule uuid, _at timestamptz, _space uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _zone text := public.reward_zone(_space);
  _start timestamptz := date_trunc('month', _at at time zone _zone) at time zone _zone;
begin
  return (
    select count(*)::integer from public.reward_entries e
    where e.rule_id = _rule
      and e.source_kind <> 'bonus'
      and e.corrects_id is null
      and e.reversed_at is null
      and e.amount > 0
      and e.status in ('pending', 'approved', 'paid')
      and e.occurred_at >= _start
      and e.occurred_at < _start + interval '1 month'
  );
end;
$$;

-- The amount still under a rule's monthly cap (a bonus does not count against it).
create or replace function public.reward_capped(
  _rule_id uuid,
  _cap numeric,
  _currency text,
  _amount numeric,
  _at timestamptz,
  _space uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _zone text := public.reward_zone(_space);
  _start timestamptz;
  _used numeric;
begin
  if _cap is null or _rule_id is null or _amount <= 0 then
    return _amount;
  end if;
  _start := date_trunc('month', _at at time zone _zone) at time zone _zone;
  select coalesce(sum(e.amount), 0) into _used
  from public.reward_entries e
  where e.rule_id = _rule_id
    and e.currency = _currency
    and e.source_kind <> 'bonus'
    and e.status in ('pending', 'approved', 'paid')
    and e.occurred_at >= _start
    and e.occurred_at < _start + interval '1 month';
  return greatest(least(_amount, _cap - _used), 0);
end;
$$;

-- What the event rules of a worker's plan pay for one event: every rule
-- whose conditions hold, at its amount; of the rules that pay "only the
-- highest", the highest one. `_s` describes the event (EventSubject).
create or replace function public.reward_wishes_for(
  _worker uuid,
  _s jsonb,
  _at timestamptz,
  _status text default null
)
returns public.reward_wish[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _d jsonb;
  _zone text;
  _type text;
  _amount numeric;
  _currency text;
  _cap numeric;
  _value numeric;
  _state text;
  _subject uuid := nullif(_s ->> 'subject_id', '')::uuid;
  _wish public.reward_wish;
  _best public.reward_wish;
  _wishes public.reward_wish[] := '{}';
  _event jsonb := _s || jsonb_build_object('at', _at);
begin
  if _worker is null then
    return _wishes;
  end if;
  _plan := public.reward_plan_for(_worker, _at);
  if _plan.id is null then
    return _wishes;
  end if;
  _zone := public.reward_zone(_plan.space_id);
  _state := coalesce(_status, public.reward_status_for(_plan));
  for _rule in
    select * from public.reward_plan_rules r
    where r.plan_id = _plan.id and r.kind = 'event' and r.active
      and r.definition -> 'event' ->> 'key' = _s ->> 'event'
    order by r.position, r.created_at
  loop
    _d := _rule.definition;
    continue when not public.reward_rule_matches(_d, _event, _plan.currency, _zone);
    _type := _d -> 'reward' ->> 'type';
    _cap := (_d -> 'limits' ->> 'cap')::numeric;
    _currency := _plan.currency;
    _amount := null;
    if _type = 'fixed' then
      _amount := (_d -> 'reward' ->> 'amount')::numeric;
    elsif _type = 'unit' then
      _amount := round((_d -> 'reward' ->> 'amount')::numeric * coalesce((_s ->> 'units')::numeric, 0), 2);
    elsif _type = 'tiers' then
      select (t ->> 'amount')::numeric into _amount
      from jsonb_array_elements(_d -> 'reward' -> 'tiers') t
      where (t ->> 'from')::integer <= public.reward_rule_count(_rule.id, _at, _plan.space_id) + 1
      order by (t ->> 'from')::integer desc
      limit 1;
    elsif _type = 'percent' then
      _value := coalesce((_s ->> 'value')::numeric, 0);
      continue when _value <= 0 or _s ->> 'currency' is null;
      _amount := round(_value * (_d -> 'reward' ->> 'percent')::numeric / 100, 2);
      _currency := _s ->> 'currency';
      -- A share in another currency than the plan's: the cap (in the plan's) does not apply.
      if _currency <> _plan.currency then
        _cap := null;
      end if;
    elsif _type = 'price' then
      _amount := (_s ->> 'price')::numeric;
      _currency := coalesce(_s ->> 'price_currency', _plan.currency);
    end if;
    continue when _amount is null or _amount <= 0;
    _wish := row(_worker, 'event', _rule.id, _amount, _currency, _state, _at, _s ->> 'note', _cap,
                 _subject, public.reward_rule_once(_d))::public.reward_wish;
    if coalesce(_d ->> 'stack', 'sum') = 'max' then
      if _best.rule_id is null or _amount > _best.amount then
        _best := _wish;
      end if;
    else
      _wishes := _wishes || _wish;
    end if;
  end loop;
  if _best.rule_id is not null then
    _wishes := _wishes || _best;
  end if;
  return _wishes;
end;
$$;

-- The bonus of a rule for the month of `_at`: one entry (a fixed source id)
-- while the month's count reaches it; an unpaid one goes when it no longer does.
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
begin
  select * into _rule from public.reward_plan_rules where id = _rule_id;
  if _rule.id is null or _rule.kind <> 'event' then
    return;
  end if;
  _zone := public.reward_zone(_rule.space_id);
  _month := date_trunc('month', _at at time zone _zone)::date;
  _source := md5(_rule.id::text || ':bonus:' || to_char(_month, 'YYYY-MM'))::uuid;
  _bonus := _rule.definition -> 'limits' -> 'bonus';
  _plan := public.reward_plan_for(_rule.worker_id, _at);
  if _bonus is not null and _rule.active and _plan.id is not null
     and public.reward_rule_count(_rule.id, _at, _rule.space_id) >= (_bonus ->> 'count')::integer then
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
  else
    delete from public.reward_entries
    where source_kind = 'bonus' and source_id = _source and status <> 'paid'
      and corrects_id is null and reversed_at is null;
  end if;
end;
$$;

-- Makes the entries of one source match the wishes (as in 28.2), with the
-- subject of "only the first time" and the bonuses of the rules it touched.
--   mode 'sync': entries without a wish go (unpaid) or get a correction (paid)
--   mode 'add':  only adds what is missing (a call, a meeting: facts)
--   mode 'drop_planned': only the planned entries go (the source was deleted)
create or replace function public.reward_reconcile(
  _space uuid,
  _source_kind text,
  _source_id uuid,
  _wishes public.reward_wish[],
  _mode text default 'sync'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _entry public.reward_entries;
  _wish public.reward_wish;
  _used boolean[] := array_fill(false, array[greatest(coalesce(array_length(_wishes, 1), 0), 1)]);
  _i integer;
  _match integer;
  _amount numeric;
  _rules uuid[] := '{}';
  _rule uuid;
begin
  if _mode = 'drop_planned' then
    delete from public.reward_entries
    where source_kind = _source_kind and source_id = _source_id and status = 'planned';
    return;
  end if;

  for _entry in
    select * from public.reward_entries
    where source_kind = _source_kind and source_id = _source_id
      and corrects_id is null and reversed_at is null and rule_kind <> 'manual'
    order by created_at, id
  loop
    _match := null;
    for _i in 1 .. coalesce(array_length(_wishes, 1), 0) loop
      _wish := _wishes[_i];
      if not _used[_i]
         and _wish.worker_id = _entry.worker_id
         and _wish.rule_kind = _entry.rule_kind
         and _wish.rule_id is not distinct from _entry.rule_id then
        _match := _i;
        exit;
      end if;
    end loop;

    if _match is null then
      continue when _mode = 'add';
      if _entry.status = 'paid' then
        perform public.reward_correct(_entry, null);
      else
        delete from public.reward_entries where id = _entry.id;
      end if;
      if _entry.rule_id is not null then
        _rules := _rules || _entry.rule_id;
      end if;
      continue;
    end if;

    _used[_match] := true;
    _wish := _wishes[_match];
    if _wish.status = 'planned' then
      if _entry.status = 'planned' then
        update public.reward_entries
        set amount = _wish.amount, currency = _wish.currency, occurred_at = _wish.occurred_at,
            note = left(_wish.note, 300)
        where id = _entry.id
          and (amount, currency, occurred_at, note) is distinct from
              (_wish.amount, _wish.currency, _wish.occurred_at, left(_wish.note, 300));
      elsif _entry.status = 'paid' then
        perform public.reward_correct(_entry, null);
        insert into public.reward_entries (
          space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
          status, occurred_at, note, subject_id, once
        ) values (
          _space, _wish.worker_id, _source_kind, _source_id, _wish.rule_id, _wish.rule_kind,
          _wish.amount, _wish.currency, 'planned', _wish.occurred_at, left(_wish.note, 300),
          _wish.subject_id, coalesce(_wish.once, false)
        );
      else
        -- Reopened: the reward waits again.
        update public.reward_entries
        set status = 'planned', amount = _wish.amount, currency = _wish.currency,
            occurred_at = _wish.occurred_at, approved_at = null, approved_by = null,
            note = left(_wish.note, 300)
        where id = _entry.id;
      end if;
      if _entry.rule_id is not null then
        _rules := _rules || _entry.rule_id;
      end if;
    elsif _entry.status = 'planned' then
      -- Done: the planned reward is earned.
      _amount := public.reward_capped(_wish.rule_id, _wish.cap, _wish.currency, _wish.amount, _wish.occurred_at, _space);
      if _amount <= 0 then
        delete from public.reward_entries where id = _entry.id;
      else
        update public.reward_entries
        set status = _wish.status, amount = _amount, currency = _wish.currency,
            occurred_at = _wish.occurred_at, note = left(_wish.note, 300),
            approved_at = case when _wish.status = 'approved' then now() end
        where id = _entry.id;
      end if;
      if _wish.rule_id is not null then
        _rules := _rules || _wish.rule_id;
      end if;
    end if;
    -- An entry already earned stays as it is: the same event pays once.
  end loop;

  for _i in 1 .. coalesce(array_length(_wishes, 1), 0) loop
    continue when _used[_i];
    _wish := _wishes[_i];
    _amount := case
      when _wish.status = 'planned' then _wish.amount
      else public.reward_capped(_wish.rule_id, _wish.cap, _wish.currency, _wish.amount, _wish.occurred_at, _space)
    end;
    continue when _amount is null or _amount <= 0;
    insert into public.reward_entries (
      space_id, worker_id, source_kind, source_id, rule_id, rule_kind, amount, currency,
      status, occurred_at, approved_at, note, subject_id, once
    ) values (
      _space, _wish.worker_id, _source_kind, _source_id, _wish.rule_id, _wish.rule_kind,
      _amount, _wish.currency, _wish.status, _wish.occurred_at,
      case when _wish.status = 'approved' then now() end, left(_wish.note, 300),
      _wish.subject_id, coalesce(_wish.once, false)
    )
    on conflict do nothing;
    if _wish.rule_id is not null and _wish.status <> 'planned' then
      _rules := _rules || _wish.rule_id;
    end if;
  end loop;

  for _rule in select distinct u from unnest(_rules) u loop
    if exists (select 1 from public.reward_plan_rules r where r.id = _rule and r.definition -> 'limits' ? 'bonus') then
      perform public.reward_bonus_sync(_rule, coalesce(
        (select max(w.occurred_at) from unnest(_wishes) w where w.rule_id = _rule), now()));
    end if;
  end loop;
end;
$$;

-- The event rules of 28.2 paid every rule of one kind; kept for anything
-- that still calls it: the kind's converted rules, through the event.
create or replace function public.reward_event(
  _worker uuid,
  _rule_kind text,
  _source_kind text,
  _source_id uuid,
  _at timestamptz,
  _note text,
  _units numeric default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
  _wishes public.reward_wish[];
begin
  if _worker is null then
    return;
  end if;
  _plan := public.reward_plan_for(_worker, _at);
  if _plan.id is null then
    return;
  end if;
  _wishes := public.reward_wishes_for(_worker, jsonb_build_object(
    'event', case _rule_kind when 'hourly' then 'time.hour' when 'per_meeting' then 'meeting.booked' else '' end,
    'did', true, 'on_record', true, 'units', _units, 'note', _note, 'subject_id', _source_id), _at, null);
  if coalesce(array_length(_wishes, 1), 0) > 0 then
    perform public.reward_reconcile(_plan.space_id, _source_kind, _source_id, _wishes, 'add');
  end if;
end;
$$;

-- One event of one worker: the wishes of their plan, reconciled with the source.
create or replace function public.reward_fire(
  _worker uuid,
  _s jsonb,
  _source_kind text,
  _source_id uuid,
  _at timestamptz,
  _mode text default 'add'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _wishes public.reward_wish[];
  _space uuid;
begin
  if _worker is null then
    return;
  end if;
  _wishes := public.reward_wishes_for(_worker, _s, _at, null);
  if coalesce(array_length(_wishes, 1), 0) = 0 then
    return;
  end if;
  select w.owner_id into _space from public.workers w where w.id = _worker;
  perform public.reward_reconcile(_space, _source_kind, _source_id, _wishes, _mode);
end;
$$;

-- The active workers an event is about: who did it and who is on the record.
create or replace function public.reward_candidates(_space uuid, _actor uuid, _record uuid[])
returns table (worker uuid, did boolean, on_record boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, coalesce(w.user_id = _actor, false), w.user_id = any (coalesce(_record, '{}'::uuid[]))
  from public.workers w
  where w.owner_id = _space and w.status = 'active' and w.user_id is not null
    and (w.user_id = _actor or w.user_id = any (coalesce(_record, '{}'::uuid[])));
$$;

-- Everybody on a deal: whoever made it and the people on it.
create or replace function public.reward_deal_people(_deal uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct p) filter (where p is not null), '{}'::uuid[])
  from (
    select d.created_by as p from public.deals d where d.id = _deal
    union all
    select a.assignee_id from public.deal_assignees a where a.deal_id = _deal
  ) people;
$$;

-- The event for every worker it is about, one reconcile of the source.
create or replace function public.reward_fire_people(
  _space uuid,
  _actor uuid,
  _record uuid[],
  _s jsonb,
  _source_kind text,
  _source_id uuid,
  _at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _c record;
  _wishes public.reward_wish[] := '{}';
begin
  for _c in select * from public.reward_candidates(_space, _actor, _record) loop
    _wishes := _wishes || public.reward_wishes_for(_c.worker,
      _s || jsonb_build_object('did', _c.did, 'on_record', _c.on_record), _at, null);
  end loop;
  if coalesce(array_length(_wishes, 1), 0) > 0 then
    perform public.reward_reconcile(_space, _source_kind, _source_id, _wishes, 'add');
  end if;
end;
$$;

-- What the rules read about a contact: its tags, whether it has a phone and an e-mail, its name.
create or replace function public.reward_contact_facts(_contact uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'tags', to_jsonb(c.tags),
      'has_phone', nullif(btrim(coalesce(c.phone, '')), '') is not null,
      'has_email', nullif(btrim(coalesce(c.email, '')), '') is not null,
      'note', coalesce(nullif(btrim(c.company_name), ''),
                       nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')))
    from public.contacts c where c.id = _contact
  ), '{}'::jsonb);
$$;

-- A move out of a rule's "to" (tables or stages) takes back the latest
-- reward of that contact or deal by the rules that cancel, unless it is paid.
create or replace function public.reward_undo_move(
  _space uuid,
  _event text,
  _from uuid,
  _to uuid,
  _subject uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rule uuid;
  _entry public.reward_entries;
begin
  if _from is null or _subject is null then
    return;
  end if;
  for _rule in
    select r.id from public.reward_plan_rules r
    where r.space_id = _space and r.kind = 'event'
      and r.definition -> 'event' ->> 'key' = _event
      and coalesce(r.definition ->> 'undo', 'cancel') = 'cancel'
      and r.definition -> 'event' -> 'to' ->> 'mode' = 'only'
      and (r.definition -> 'event' -> 'to' -> 'ids') ? _from::text
      and not coalesce((r.definition -> 'event' -> 'to' -> 'ids') ? _to::text, false)
  loop
    select * into _entry from public.reward_entries e
    where e.rule_id = _rule and e.subject_id = _subject and e.source_kind <> 'bonus'
      and e.corrects_id is null and e.reversed_at is null
    order by e.occurred_at desc, e.created_at desc
    limit 1;
    continue when _entry.id is null or _entry.status = 'paid';
    delete from public.reward_entries where id = _entry.id;
    perform public.reward_bonus_sync(_rule, _entry.occurred_at);
  end loop;
end;
$$;

-- A meeting from a call taken back (the contact left "Meeting scheduled").
create or replace function public.reward_undo_meeting_call(_space uuid, _contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rule uuid;
  _entry public.reward_entries;
begin
  for _rule in
    select r.id from public.reward_plan_rules r
    where r.space_id = _space and r.kind = 'event'
      and r.definition -> 'event' ->> 'key' = 'meeting.booked'
      and coalesce(r.definition ->> 'undo', 'cancel') = 'cancel'
      and coalesce((r.definition -> 'event' -> 'via') ? 'calls', true)
  loop
    select * into _entry from public.reward_entries e
    where e.rule_id = _rule and e.subject_id = _contact and e.source_kind = 'contact_move'
      and e.corrects_id is null and e.reversed_at is null
    order by e.occurred_at desc, e.created_at desc
    limit 1;
    continue when _entry.id is null or _entry.status = 'paid';
    delete from public.reward_entries where id = _entry.id;
    perform public.reward_bonus_sync(_rule, _entry.occurred_at);
  end loop;
end;
$$;

-- The unpaid rewards of a source taken back: every one (`_all`, a storno) or
-- only those of rules that cancel (a deleted meeting or call).
create or replace function public.reward_undo_source(_source_kind text, _source_id uuid, _all boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _entry public.reward_entries;
begin
  for _entry in
    select e.* from public.reward_entries e
    left join public.reward_plan_rules r on r.id = e.rule_id
    where e.source_kind = _source_kind and e.source_id = _source_id
      and e.status <> 'paid' and e.corrects_id is null and e.reversed_at is null
      and e.rule_kind <> 'manual'
      and (_all or coalesce(r.definition ->> 'undo', 'cancel') = 'cancel')
  loop
    delete from public.reward_entries where id = _entry.id;
    if _entry.rule_id is not null then
      perform public.reward_bonus_sync(_entry.rule_id, _entry.occurred_at);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Tasks, deals and milestones (synced sources, as in 28.2)
-- -----------------------------------------------------------------------------

-- The wishes of a task of any kind: its own price to the person it is for
-- (the first price rule's conditions and cap), else the task rules for the
-- person it is for and for whoever did it.
create or replace function public.reward_task_wishes_for(
  _kind text,
  _record uuid,
  _self uuid,
  _done boolean,
  _at timestamptz,
  _on_time boolean,
  _price numeric,
  _price_currency text,
  _note text,
  _facts jsonb
)
returns public.reward_wish[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _plan public.reward_plans;
  _rule public.reward_plan_rules;
  _wishes public.reward_wish[] := '{}';
  _status text;
  _s jsonb := coalesce(_facts, '{}'::jsonb) || jsonb_build_object(
    'event', 'task.done', 'task_kind', _kind, 'on_time', _on_time, 'note', _note);
begin
  if _price is not null then
    if _record is null then
      return _wishes;
    end if;
    _plan := public.reward_plan_for(_record, _at);
    if _plan.id is null then
      return _wishes;
    end if;
    _status := case when _done then public.reward_status_for(_plan) else 'planned' end;
    select * into _rule from public.reward_plan_rules r
    where r.plan_id = _plan.id and r.kind = 'event' and r.active
      and r.definition -> 'event' ->> 'key' = 'task.done'
      and r.definition -> 'reward' ->> 'type' = 'price'
      and (jsonb_array_length(coalesce(r.definition -> 'event' -> 'taskKinds', '[]'::jsonb)) = 0
           or coalesce((r.definition -> 'event' -> 'taskKinds') ? _kind, true))
    order by r.position, r.created_at limit 1;
    if _done and _rule.id is not null and not public.reward_rule_matches(
      _rule.definition,
      _s || jsonb_build_object('priced', true, 'did', _record = _self, 'on_record', true, 'at', _at),
      _plan.currency, public.reward_zone(_plan.space_id)) then
      return _wishes;
    end if;
    return array[row(_record, case when _rule.id is null then 'task_fixed' else 'event' end, _rule.id,
      _price, _price_currency, _status, _at, _note, (_rule.definition -> 'limits' ->> 'cap')::numeric,
      null, false)::public.reward_wish];
  end if;

  if not _done then
    return _wishes;
  end if;
  if _record is not null then
    _wishes := _wishes || public.reward_wishes_for(_record,
      _s || jsonb_build_object('priced', false, 'did', _record = _self, 'on_record', true), _at, null);
  end if;
  if _self is not null and _self is distinct from _record then
    _wishes := _wishes || public.reward_wishes_for(_self,
      _s || jsonb_build_object('priced', false, 'did', true, 'on_record', false), _at, null);
  end if;
  return _wishes;
end;
$$;

-- The signature of 28.2: one person who both is on the task and did it.
create or replace function public.reward_task_wishes(
  _worker uuid,
  _done boolean,
  _at timestamptz,
  _on_time boolean,
  _price numeric,
  _price_currency text,
  _note text
)
returns public.reward_wish[]
language sql
stable
security definer
set search_path = ''
as $$
  select public.reward_task_wishes_for(null, _worker, _worker, _done, _at, _on_time, _price,
    _price_currency, _note, '{}'::jsonb);
$$;

-- Sales tasks: the person it is given to, and whoever ticked it off.
create or replace function public.reward_sync_crm_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.crm_tasks;
  _done boolean;
begin
  select * into _task from public.crm_tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'crm_task', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _task.status = 'done';
  perform public.reward_reconcile(
    _task.user_id, 'crm_task', _id,
    public.reward_task_wishes_for(
      'crm_task',
      public.reward_worker_of(_task.user_id, _task.assignee_id),
      case when _done then public.reward_worker_of(_task.user_id, _task.completed_by) end,
      _done,
      case when _done then coalesce(_task.completed_at, now()) else _task.due_at end,
      date_trunc('minute', coalesce(_task.completed_at, now())) <= date_trunc('minute', _task.due_at),
      _task.reward_amount, _task.reward_currency, _task.title,
      case when _task.contact_id is not null
        then jsonb_build_object('tags', (public.reward_contact_facts(_task.contact_id)) -> 'tags')
        else '{}'::jsonb end),
    'sync');
end;
$$;

-- Tasks from the owner: the worker they are given to (who also ticks them off).
create or replace function public.reward_sync_worker_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.worker_tasks;
  _done boolean;
  _zone text;
  _worker uuid;
begin
  select * into _task from public.worker_tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'worker_task', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _task.status = 'done';
  _zone := public.reward_zone(_task.owner_id);
  select w.id into _worker from public.workers w where w.id = _task.worker_id and w.status = 'active';
  perform public.reward_reconcile(
    _task.owner_id, 'worker_task', _id,
    public.reward_task_wishes_for(
      'worker_task', _worker, _worker,
      _done,
      case
        when _done then coalesce(_task.completed_at, now())
        when _task.due_date is not null then (_task.due_date + time '12:00') at time zone _zone
        else now()
      end,
      _task.due_date is null or (coalesce(_task.completed_at, now()) at time zone _zone)::date <= _task.due_date,
      _task.reward_amount, _task.reward_currency, _task.title, '{}'::jsonb),
    'sync');
end;
$$;

-- Tasks of milestones have nobody assigned: whoever ticks one off.
create or replace function public.reward_sync_task(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _task public.tasks;
  _zone text;
  _worker uuid;
begin
  select * into _task from public.tasks where id = _id;
  if _task.id is null then
    perform public.reward_reconcile(_space, 'task', _id, '{}', 'drop_planned');
    return;
  end if;
  if _task.status <> 'done' then
    perform public.reward_reconcile(_task.user_id, 'task', _id, '{}', 'sync');
    return;
  end if;
  _zone := public.reward_zone(_task.user_id);
  _worker := public.reward_worker_of(_task.user_id, _task.completed_by);
  perform public.reward_reconcile(
    _task.user_id, 'task', _id,
    public.reward_task_wishes_for(
      'task', _worker, _worker,
      true,
      coalesce(_task.completed_at, now()),
      _task.due_date is null or (coalesce(_task.completed_at, now()) at time zone _zone)::date <= _task.due_date,
      _task.reward_amount, _task.reward_currency, _task.title, '{}'::jsonb),
    'sync');
end;
$$;

-- Milestones: the worker whose project it is (reward_worker_id).
create or replace function public.reward_sync_milestone(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _milestone public.milestones;
  _worker uuid;
  _plan public.reward_plans;
  _wishes public.reward_wish[] := '{}';
  _done boolean;
  _at timestamptz;
  _status text;
begin
  select * into _milestone from public.milestones where id = _id;
  if _milestone.id is null then
    perform public.reward_reconcile(_space, 'milestone', _id, '{}', 'drop_planned');
    return;
  end if;
  _done := _milestone.status = 'completed';
  _at := case when _done then coalesce(_milestone.completed_at, now()) else now() end;
  select w.id into _worker from public.workers w
  where w.id = _milestone.reward_worker_id and w.status = 'active';
  if _worker is not null and _milestone.status <> 'archived' then
    _plan := public.reward_plan_for(_worker, _at);
  end if;
  if _plan.id is not null then
    _status := case when _done then public.reward_status_for(_plan) else 'planned' end;
    if _milestone.reward_amount is not null then
      _wishes := _wishes || row(_worker, 'price', null, _milestone.reward_amount,
        _milestone.reward_currency, _status, _at, _milestone.title, null, null, false)::public.reward_wish;
    end if;
    if _done then
      _wishes := _wishes || public.reward_wishes_for(_worker, jsonb_build_object(
        'event', 'milestone.done', 'did', false, 'on_record', true, 'subject_id', _milestone.id,
        'note', _milestone.title), _at, _status);
    end if;
  end if;
  perform public.reward_reconcile(_milestone.user_id, 'milestone', _id, _wishes, 'sync');
end;
$$;

-- Deals: everyone on the deal (its own price and the rules "on the record"),
-- and whoever won or lost it (the rules "the worker themself").
create or replace function public.reward_sync_deal(_id uuid, _space uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _deal public.deals;
  _c record;
  _plan public.reward_plans;
  _wishes public.reward_wish[] := '{}';
  _won boolean;
  _lost boolean;
  _open boolean;
  _at timestamptz;
  _status text;
  _actor uuid;
  _s jsonb;
begin
  select * into _deal from public.deals where id = _id;
  if _deal.id is null then
    perform public.reward_reconcile(_space, 'deal', _id, '{}', 'drop_planned');
    return;
  end if;
  _won := _deal.won_at is not null;
  _lost := not _won and _deal.lost_at is not null;
  _open := not _won and not _lost;
  _at := case when _lost then coalesce(_deal.lost_at, now()) else coalesce(_deal.won_at, now()) end;
  if not _open then
    select e.actor_id into _actor from public.deal_events e
    where e.deal_id = _deal.id and e.kind = 'stage'
      and coalesce((e.payload ->> case when _won then 'won' else 'lost' end)::boolean, false)
    order by e.occurred_at desc limit 1;
    _actor := coalesce(_actor, _deal.created_by);
  end if;
  _s := (case when _deal.contact_id is not null
           then jsonb_build_object('tags', public.reward_contact_facts(_deal.contact_id) -> 'tags')
           else '{}'::jsonb end)
    || jsonb_build_object('event', case when _lost then 'deal.lost' else 'deal.won' end,
         'value', coalesce(_deal.value, 0), 'currency', _deal.currency, 'subject_id', _deal.id,
         'note', _deal.title);

  for _c in select * from public.reward_candidates(_deal.user_id, _actor, public.reward_deal_people(_deal.id)) loop
    _plan := public.reward_plan_for(_c.worker, _at);
    continue when _plan.id is null;
    _status := case when _open then 'planned' else public.reward_status_for(_plan) end;
    if _c.on_record and not _lost and _deal.reward_amount is not null then
      _wishes := _wishes || row(_c.worker, 'price', null, _deal.reward_amount, _deal.reward_currency,
        _status, _at, _deal.title, null, null, false)::public.reward_wish;
    end if;
    continue when _open;
    _wishes := _wishes || public.reward_wishes_for(_c.worker,
      _s || jsonb_build_object('did', _c.did, 'on_record', _c.on_record), _at, _status);
  end loop;
  perform public.reward_reconcile(_deal.user_id, 'deal', _id, _wishes, 'sync');
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. The events
-- -----------------------------------------------------------------------------

-- Cold Calling: a move between tables, a meeting from a call (into "Meeting
-- scheduled"); a move out of a rule's tables takes back what it paid.
create or replace function public.reward_on_contact_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
  _from text;
  _to text;
  _facts jsonb;
begin
  if new.source is not distinct from 'scheduler' then
    return null;
  end if;
  select t.system_key into _from from public.contact_tables t where t.id = new.from_table_id;
  select t.system_key into _to from public.contact_tables t where t.id = new.to_table_id;

  -- Moving back cancels, whoever moves it back.
  perform public.reward_undo_move(new.user_id, 'contact.moved', new.from_table_id, new.to_table_id, new.contact_id);
  if _from = 'meeting_scheduled' and _to is distinct from 'meeting_scheduled' then
    perform public.reward_undo_meeting_call(new.user_id, new.contact_id);
  end if;

  if new.actor_id is null then
    return null;
  end if;
  _worker := public.reward_worker_of(new.user_id, new.actor_id);
  if _worker is null then
    return null;
  end if;
  _facts := public.reward_contact_facts(new.contact_id)
    || jsonb_build_object('did', true, 'on_record', true, 'subject_id', new.contact_id);
  perform public.reward_fire(_worker,
    _facts || jsonb_build_object('event', 'contact.moved', 'from_id', new.from_table_id, 'to_id', new.to_table_id),
    'contact_move', new.id, new.created_at, 'add');
  if _to = 'meeting_scheduled' then
    perform public.reward_fire(_worker,
      _facts || jsonb_build_object('event', 'meeting.booked', 'via', 'calls'),
      'contact_move', new.id, new.created_at, 'add');
  end if;
  return null;
end;
$$;

-- Pipeline: a deal moved between stages; a move out of a rule's stages takes back what it paid.
create or replace function public.reward_on_deal_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _deal public.deals;
  _from uuid := nullif(new.payload ->> 'from_stage_id', '')::uuid;
  _to uuid := nullif(new.payload ->> 'to_stage_id', '')::uuid;
begin
  if new.kind <> 'stage' then
    return null;
  end if;
  select * into _deal from public.deals where id = new.deal_id;
  if _deal.id is null or _deal.is_demo then
    return null;
  end if;
  perform public.reward_undo_move(new.user_id, 'deal.moved', _from, _to, new.deal_id);
  perform public.reward_fire_people(
    new.user_id, new.actor_id, public.reward_deal_people(new.deal_id),
    (case when _deal.contact_id is not null
       then jsonb_build_object('tags', public.reward_contact_facts(_deal.contact_id) -> 'tags')
       else '{}'::jsonb end)
    || jsonb_build_object('event', 'deal.moved', 'from_id', _from, 'to_id', _to,
         'value', coalesce(_deal.value, 0), 'currency', _deal.currency,
         'subject_id', _deal.id, 'note', _deal.title),
    'deal_event', new.id, new.occurred_at);
  return null;
end;
$$;
drop trigger if exists deal_events_rewards on public.deal_events;
create trigger deal_events_rewards
  after insert on public.deal_events
  for each row execute function public.reward_on_deal_event();

-- A call written to a contact; deleting it takes back what it paid.
create or replace function public.reward_on_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
begin
  if tg_op = 'DELETE' then
    if old.type = 'call' then
      perform public.reward_undo_source('activity', old.id, false);
    end if;
    return null;
  end if;
  if new.type <> 'call' or new.actor_id is null then
    return null;
  end if;
  _worker := public.reward_worker_of(new.user_id, new.actor_id);
  if _worker is null then
    return null;
  end if;
  perform public.reward_fire(
    _worker,
    public.reward_contact_facts(new.contact_id) || jsonb_build_object(
      'event', 'call.logged', 'did', true, 'on_record', true, 'subject_id', new.contact_id),
    'activity', new.id, coalesce(new.occurred_at, new.created_at), 'add');
  return null;
end;
$$;
drop trigger if exists contact_activities_rewards on public.contact_activities;
create trigger contact_activities_rewards
  after insert or delete on public.contact_activities
  for each row execute function public.reward_on_activity();

-- A meeting put into the calendar by hand; deleting it takes back what it paid.
create or replace function public.reward_on_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
begin
  if tg_op = 'DELETE' then
    if old.kind = 'meeting' then
      perform public.reward_undo_source('calendar_event', old.id, false);
    end if;
    return null;
  end if;
  if new.kind <> 'meeting' or new.source <> 'manual' or new.is_demo or new.actor_id is null then
    return null;
  end if;
  _worker := public.reward_worker_of(new.user_id, new.actor_id);
  if _worker is null then
    return null;
  end if;
  perform public.reward_fire(
    _worker,
    (case when new.contact_id is not null then public.reward_contact_facts(new.contact_id) else '{}'::jsonb end)
    || jsonb_build_object('event', 'meeting.booked', 'via', 'calendar', 'did', true, 'on_record', true,
         'subject_id', coalesce(new.contact_id, new.id), 'note', new.title),
    'calendar_event', new.id, new.created_at, 'add');
  return null;
end;
$$;
drop trigger if exists calendar_events_rewards on public.calendar_events;
create trigger calendar_events_rewards
  after insert or delete on public.calendar_events
  for each row execute function public.reward_on_calendar_event();

-- A new contact (and one that gets its phone or e-mail later): who made it.
create or replace function public.reward_on_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
begin
  if new.is_demo or new.created_by is null or new.deleted_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and not (
    (nullif(btrim(coalesce(old.phone, '')), '') is null and nullif(btrim(coalesce(new.phone, '')), '') is not null)
    or (nullif(btrim(coalesce(old.email, '')), '') is null and nullif(btrim(coalesce(new.email, '')), '') is not null)
  ) then
    return null;
  end if;
  -- An owner's own contact (no worker record) costs one lookup, nothing more.
  _worker := public.reward_worker_of(new.user_id, new.created_by);
  if _worker is null then
    return null;
  end if;
  perform public.reward_fire(
    _worker,
    public.reward_contact_facts(new.id) || jsonb_build_object(
      'event', 'contact.created', 'did', true, 'on_record', true, 'subject_id', new.id),
    'contact', new.id, new.created_at, 'add');
  return null;
end;
$$;
drop trigger if exists contacts_rewards on public.contacts;
create trigger contacts_rewards
  after insert or update of phone, email on public.contacts
  for each row execute function public.reward_on_contact();

-- Invoices: issued, paid (by the signed-in person; the people of its deal are
-- on the record); a storno takes back every unpaid reward of the invoice.
create or replace function public.reward_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _s jsonb;
  _people uuid[];
begin
  if new.kind <> 'invoice' then
    return null;
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    perform public.reward_undo_source('invoice', new.id, true);
    return null;
  end if;
  if not ((old.issued_on is null and new.issued_on is not null) or (old.paid_on is null and new.paid_on is not null)) then
    return null;
  end if;
  _people := case when new.deal_id is not null then public.reward_deal_people(new.deal_id) else '{}'::uuid[] end;
  _s := (case when new.contact_id is not null
           then jsonb_build_object('tags', public.reward_contact_facts(new.contact_id) -> 'tags')
           else '{}'::jsonb end)
    || jsonb_build_object('value', new.subtotal, 'currency', new.currency, 'subject_id', new.id,
         'note', coalesce(new.number, new.customer_name));
  if old.issued_on is null and new.issued_on is not null then
    perform public.reward_fire_people(new.user_id, auth.uid(), _people,
      _s || '{"event": "invoice.issued"}'::jsonb, 'invoice', new.id, now());
  end if;
  if old.paid_on is null and new.paid_on is not null then
    perform public.reward_fire_people(new.user_id, auth.uid(), _people,
      _s || '{"event": "invoice.paid"}'::jsonb, 'invoice', new.id, now());
  end if;
  return null;
end;
$$;
drop trigger if exists invoices_rewards on public.invoices;
create trigger invoices_rewards
  after update of issued_on, paid_on, cancelled_at on public.invoices
  for each row execute function public.reward_on_invoice();

-- Scheduler: a booking that came in, one confirmed with a worker as host;
-- cancelled or declined = undone; a no-show takes back "held".
create or replace function public.reward_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _worker uuid;
  _facts jsonb;
begin
  if new.host_user_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status in ('pending', 'confirmed') and new.status in ('cancelled', 'declined') then
    perform public.reward_reconcile(new.space_id, 'booking', new.id, '{}', 'sync');
    return null;
  end if;
  if tg_op = 'UPDATE' and old.no_show_at is null and new.no_show_at is not null then
    delete from public.reward_entries e
    using public.reward_plan_rules r
    where r.id = e.rule_id and e.source_kind = 'booking' and e.source_id = new.id
      and r.definition -> 'event' ->> 'key' = 'meeting.held' and e.status <> 'paid'
      and e.corrects_id is null and e.reversed_at is null;
  end if;
  _worker := public.reward_worker_of(new.space_id, new.host_user_id);
  if _worker is null then
    return null;
  end if;
  _facts := (case when new.contact_id is not null then public.reward_contact_facts(new.contact_id) else '{}'::jsonb end)
    || jsonb_build_object('did', true, 'on_record', true, 'subject_id', new.id, 'note', new.guest_company);
  if new.status in ('pending', 'confirmed')
     and (tg_op = 'INSERT' or old.status not in ('pending', 'confirmed')) then
    perform public.reward_fire(_worker, _facts || '{"event": "booking.received"}'::jsonb,
      'booking', new.id, coalesce(new.created_at, now()), 'add');
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    perform public.reward_fire(_worker, _facts || '{"event": "meeting.booked", "via": "scheduler"}'::jsonb,
      'booking', new.id, coalesce(new.confirmed_at, now()), 'add');
  end if;
  return null;
end;
$$;
drop trigger if exists bookings_rewards on public.bookings;
create trigger bookings_rewards
  after insert or update of status, no_show_at on public.bookings
  for each row execute function public.reward_on_booking();

-- The worker's own timer: hours of a closed session.
create or replace function public.reward_on_work_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _hours numeric;
begin
  if old.ended_at is null and new.ended_at is not null then
    _hours := extract(epoch from new.ended_at - new.started_at) / 3600.0;
    if _hours > 0 then
      perform public.reward_fire(new.worker_id, jsonb_build_object(
        'event', 'time.hour', 'did', true, 'on_record', true, 'units', round(_hours, 4)),
        'work_session', new.id, new.ended_at, 'add');
    end if;
  end if;
  return null;
end;
$$;

-- A rule paying the task's price changed: what open tasks promise is re-read.
create or replace function public.reward_on_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.definition, old.definition) -> 'reward' ->> 'type' is distinct from 'price'
     and (tg_op <> 'UPDATE' or old.definition -> 'reward' ->> 'type' is distinct from 'price') then
    return null;
  end if;
  perform public.reward_resync_planned(coalesce(new.worker_id, old.worker_id));
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. The daily cron: the month, meetings that happened, last month's tiers and bonuses
-- -----------------------------------------------------------------------------

create or replace function public.reward_run_monthly()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _rule record;
  _zone text;
  _month date;
  _start timestamptz;
  _end timestamptz;
  _count integer := 0;
  _entry record;
  _plan public.reward_plans;
  _row record;
  _n integer;
  _running numeric;
  _amount numeric;
  _cap numeric;
begin
  -- Each active "every month" rule has a planned entry for the current month of its space.
  for _rule in
    select r.*, p.currency as plan_currency, p.space_id as plan_space, p.active_from, p.active_to
    from public.reward_plan_rules r
    join public.reward_plans p on p.id = r.plan_id
    join public.workers w on w.id = r.worker_id and w.status = 'active'
    where r.kind = 'event' and r.active and r.definition -> 'event' ->> 'key' = 'time.month'
  loop
    _zone := public.reward_zone(_rule.plan_space);
    _month := date_trunc('month', now() at time zone _zone)::date;
    continue when _rule.active_from is not null and _rule.active_from > (_month + interval '1 month - 1 day')::date;
    continue when _rule.active_to is not null and _rule.active_to < _month;
    _end := ((_month + interval '1 month')::timestamp at time zone _zone) - interval '1 second';
    perform public.reward_reconcile(
      _rule.plan_space, 'month',
      md5(_rule.id::text || ':' || to_char(_month, 'YYYY-MM'))::uuid,
      array[row(_rule.worker_id, 'event', _rule.id, (_rule.definition -> 'reward' ->> 'amount')::numeric,
                _rule.plan_currency, 'planned', _end, null, null, null, false)::public.reward_wish],
      'add');
  end loop;

  -- Months that ended: earned.
  for _entry in
    select e.id, e.worker_id, e.occurred_at from public.reward_entries e
    where e.source_kind = 'month' and e.status = 'planned' and e.occurred_at < now()
  loop
    _plan := public.reward_plan_for(_entry.worker_id, _entry.occurred_at);
    if _plan.id is null then
      delete from public.reward_entries where id = _entry.id;
    else
      update public.reward_entries
      set status = public.reward_status_for(_plan),
          approved_at = case when _plan.approval = 'auto' then now() end
      where id = _entry.id;
      _count := _count + 1;
    end if;
  end loop;

  -- Meetings that happened in the last week (a booking confirmed and not a no-show, a meeting in the calendar).
  for _row in
    select b.id, b.space_id, b.host_user_id, b.ends_at, b.contact_id, b.guest_company
    from public.bookings b
    where b.status = 'confirmed' and b.no_show_at is null and b.host_user_id is not null
      and b.ends_at < now() and b.ends_at >= now() - interval '7 days'
      and exists (
        select 1 from public.reward_plan_rules r join public.workers w on w.id = r.worker_id
        where r.space_id = b.space_id and w.user_id = b.host_user_id and r.kind = 'event' and r.active
          and r.definition -> 'event' ->> 'key' = 'meeting.held')
    limit 2000
  loop
    perform public.reward_fire(public.reward_worker_of(_row.space_id, _row.host_user_id),
      (case when _row.contact_id is not null then public.reward_contact_facts(_row.contact_id) else '{}'::jsonb end)
      || jsonb_build_object('event', 'meeting.held', 'via', 'scheduler', 'did', true, 'on_record', true,
           'subject_id', _row.id, 'note', _row.guest_company),
      'booking', _row.id, _row.ends_at, 'add');
  end loop;
  for _row in
    select e.id, e.user_id, e.actor_id, coalesce(e.ends_at, e.starts_at + interval '1 hour') as ended,
           e.contact_id, e.title
    from public.calendar_events e
    where e.kind = 'meeting' and e.source in ('manual', 'contact_move') and not e.is_demo and not e.all_day
      and e.actor_id is not null
      and coalesce(e.ends_at, e.starts_at + interval '1 hour') < now()
      and coalesce(e.ends_at, e.starts_at + interval '1 hour') >= now() - interval '7 days'
      and exists (
        select 1 from public.reward_plan_rules r join public.workers w on w.id = r.worker_id
        where r.space_id = e.user_id and w.user_id = e.actor_id and r.kind = 'event' and r.active
          and r.definition -> 'event' ->> 'key' = 'meeting.held')
    limit 2000
  loop
    perform public.reward_fire(public.reward_worker_of(_row.user_id, _row.actor_id),
      (case when _row.contact_id is not null then public.reward_contact_facts(_row.contact_id) else '{}'::jsonb end)
      || jsonb_build_object('event', 'meeting.held', 'via', 'calendar', 'did', true, 'on_record', true,
           'subject_id', _row.id, 'note', _row.title),
      'calendar_event', _row.id, _row.ended, 'add');
  end loop;

  -- Last month, once it ended: tiers recounted in order (unpaid rewards only,
  -- under the cap) and the bonus made or taken back. Run daily: nothing doubles.
  for _rule in
    select r.* from public.reward_plan_rules r
    where r.kind = 'event'
      and (r.definition -> 'reward' ->> 'type' = 'tiers' or r.definition -> 'limits' ? 'bonus')
  loop
    _zone := public.reward_zone(_rule.space_id);
    _month := (date_trunc('month', now() at time zone _zone) - interval '1 month')::date;
    _start := _month::timestamp at time zone _zone;
    _end := (_month + interval '1 month')::timestamp at time zone _zone;
    if _rule.definition -> 'reward' ->> 'type' = 'tiers' then
      _n := 0;
      _running := 0;
      _cap := (_rule.definition -> 'limits' ->> 'cap')::numeric;
      for _entry in
        select e.id, e.amount, e.status from public.reward_entries e
        where e.rule_id = _rule.id and e.source_kind <> 'bonus' and e.corrects_id is null
          and e.reversed_at is null and e.amount > 0 and e.status in ('pending', 'approved', 'paid')
          and e.occurred_at >= _start and e.occurred_at < _end
        order by e.occurred_at, e.created_at
      loop
        _n := _n + 1;
        if _entry.status = 'paid' then
          _running := _running + _entry.amount;
          continue;
        end if;
        select (t ->> 'amount')::numeric into _amount
        from jsonb_array_elements(_rule.definition -> 'reward' -> 'tiers') t
        where (t ->> 'from')::integer <= _n
        order by (t ->> 'from')::integer desc limit 1;
        if _cap is not null then
          _amount := greatest(least(_amount, _cap - _running), 0);
        end if;
        if _amount <= 0 then
          delete from public.reward_entries where id = _entry.id;
          _n := _n - 1;
          continue;
        end if;
        if _amount <> _entry.amount then
          update public.reward_entries set amount = _amount where id = _entry.id;
        end if;
        _running := _running + _amount;
      end loop;
    end if;
    perform public.reward_bonus_sync(_rule.id, _end - interval '1 second');
  end loop;
  return _count;
end;
$$;
revoke execute on function public.reward_run_monthly() from public, anon, authenticated;
grant execute on function public.reward_run_monthly() to service_role;

revoke execute on function
  public.reward_default_who(text),
  public.reward_rule_once(jsonb),
  public.reward_rule_matches(jsonb, jsonb, text, text),
  public.reward_rule_count(uuid, timestamptz, uuid),
  public.reward_capped(uuid, numeric, text, numeric, timestamptz, uuid),
  public.reward_wishes_for(uuid, jsonb, timestamptz, text),
  public.reward_bonus_sync(uuid, timestamptz),
  public.reward_reconcile(uuid, text, uuid, public.reward_wish[], text),
  public.reward_event(uuid, text, text, uuid, timestamptz, text, numeric),
  public.reward_fire(uuid, jsonb, text, uuid, timestamptz, text),
  public.reward_candidates(uuid, uuid, uuid[]),
  public.reward_deal_people(uuid),
  public.reward_fire_people(uuid, uuid, uuid[], jsonb, text, uuid, timestamptz),
  public.reward_contact_facts(uuid),
  public.reward_undo_move(uuid, text, uuid, uuid, uuid),
  public.reward_undo_meeting_call(uuid, uuid),
  public.reward_undo_source(text, uuid, boolean),
  public.reward_task_wishes_for(text, uuid, uuid, boolean, timestamptz, boolean, numeric, text, text, jsonb),
  public.reward_task_wishes(uuid, boolean, timestamptz, boolean, numeric, text, text),
  public.reward_sync_crm_task(uuid, uuid),
  public.reward_sync_worker_task(uuid, uuid),
  public.reward_sync_task(uuid, uuid),
  public.reward_sync_milestone(uuid, uuid),
  public.reward_sync_deal(uuid, uuid),
  public.reward_on_contact_move(),
  public.reward_on_deal_event(),
  public.reward_on_activity(),
  public.reward_on_calendar_event(),
  public.reward_on_contact(),
  public.reward_on_invoice(),
  public.reward_on_booking(),
  public.reward_on_work_session(),
  public.reward_on_rule()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. What the app reads
-- -----------------------------------------------------------------------------

-- The space's contact tables and pipeline stages by id and name, for whoever
-- reads the plan (the worker, whoever manages their rewards): a rule shows
-- its tables even to someone without Contacts.
create or replace function public.reward_plan_refs(_worker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _space uuid;
begin
  select w.owner_id into _space from public.workers w where w.id = _worker;
  if _space is null or not (_worker in (select public.my_worker_ids()) or public.reward_can_manage(_space, _worker)) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'system_key', t.system_key)
                       order by t.position)
      from public.contact_tables t where t.user_id = _space), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'system_key', s.system_key,
                                          'is_won', s.is_won, 'is_lost', s.is_lost)
                       order by s.position)
      from public.pipeline_stages s where s.user_id = _space), '[]'::jsonb));
end;
$$;
revoke execute on function public.reward_plan_refs(uuid) from public, anon;
grant execute on function public.reward_plan_refs(uuid) to authenticated;

-- The worker's events of the last `_days` days as the engine describes them
-- (EventSubject in evaluate.ts), for "Try it": a dry run in the app, nothing
-- is written. Only for whoever manages the person's rewards; names only
-- from sections the caller may see. Each kind at most 1 000 events.
create or replace function public.reward_history(_worker uuid, _days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _space uuid;
  _account uuid;
  _since timestamptz;
  _zone text;
  _owner boolean;
  _contacts boolean;
  _pipeline boolean;
  _calendar boolean;
  _finance boolean;
  _out jsonb := '[]'::jsonb;
begin
  select w.owner_id, w.user_id into _space, _account from public.workers w where w.id = _worker;
  if _space is null or not public.reward_can_manage(_space, _worker) then
    raise exception 'reward_forbidden' using errcode = 'insufficient_privilege';
  end if;
  _since := now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 90));
  _zone := public.reward_zone(_space);
  _owner := _space = auth.uid();
  _contacts := _owner or public.has_section_access(_space, 'contacts', 'view')
    or public.has_section_access(_space, 'cold_calling', 'view');
  _pipeline := _owner or public.has_section_access(_space, 'pipeline', 'view');
  _calendar := _owner or public.has_section_access(_space, 'calendar', 'view');
  _finance := _owner or public.has_section_access(_space, 'finance', 'view');

  -- Hours and the month need no account.
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'time.hour', 'at', s.ended_at, 'source_kind', 'work_session',
      'source_id', s.id, 'subject_id', null, 'did', true, 'on_record', true,
      'units', round(extract(epoch from s.ended_at - s.started_at) / 3600.0, 4)))
    from (select * from public.work_sessions s
          where s.worker_id = _worker and s.ended_at >= _since order by s.ended_at limit 1000) s
  ), '[]'::jsonb);
  _out := _out || jsonb_build_array(jsonb_build_object('event', 'time.month', 'at', now(),
    'source_kind', 'month', 'source_id', md5(_worker::text || to_char(now(), 'YYYY-MM'))::uuid,
    'subject_id', null, 'did', true, 'on_record', true));
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'task.done', 'at', t.completed_at, 'source_kind', 'worker_task',
      'source_id', t.id, 'subject_id', t.id, 'did', true, 'on_record', true, 'task_kind', 'worker_task',
      'on_time', t.due_date is null or (t.completed_at at time zone _zone)::date <= t.due_date,
      'priced', t.reward_amount is not null, 'price', t.reward_amount, 'price_currency', t.reward_currency,
      'note', t.title))
    from (select * from public.worker_tasks t
          where t.worker_id = _worker and t.status = 'done' and t.completed_at >= _since
          order by t.completed_at limit 1000) t
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'milestone.done', 'at', m.completed_at, 'source_kind', 'milestone',
      'source_id', m.id, 'subject_id', m.id, 'did', false, 'on_record', true, 'note', m.title))
    from (select * from public.milestones m
          where m.user_id = _space and m.reward_worker_id = _worker and m.status = 'completed'
            and m.completed_at >= _since order by m.completed_at limit 1000) m
  ), '[]'::jsonb);
  if _account is null then
    return _out;
  end if;

  -- Cold Calling: moves of contacts the worker moved (and their moves back), meetings from calls.
  _out := _out || coalesce((
    select jsonb_agg(x order by x ->> 'at')
    from (
      select jsonb_build_object('event', 'contact.moved', 'at', m.created_at, 'source_kind', 'contact_move',
        'source_id', m.id, 'subject_id', m.contact_id, 'did', m.actor_id = _account,
        'on_record', m.actor_id = _account, 'from_id', m.from_table_id, 'to_id', m.to_table_id,
        'tags', to_jsonb(c.tags),
        'note', case when _contacts then coalesce(nullif(btrim(c.company_name), ''),
                  nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) end) as x
      from public.contact_table_moves m
      join public.contacts c on c.id = m.contact_id
      where m.user_id = _space and m.created_at >= _since and m.source is distinct from 'scheduler'
        and m.contact_id in (
          select m2.contact_id from public.contact_table_moves m2
          where m2.user_id = _space and m2.actor_id = _account and m2.created_at >= _since)
      order by m.created_at
      limit 1000
    ) q
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object('event', 'meeting.booked', 'at', m.created_at, 'source_kind', 'contact_move',
        'source_id', m.id, 'subject_id', m.contact_id, 'via', 'calls',
        'did', m.actor_id = _account, 'on_record', m.actor_id = _account,
        'undo', coalesce(tf.system_key = 'meeting_scheduled', false) and tt.system_key is distinct from 'meeting_scheduled',
        'tags', to_jsonb(c.tags),
        'note', case when _contacts then coalesce(nullif(btrim(c.company_name), ''),
                  nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) end) as x
      from public.contact_table_moves m
      join public.contacts c on c.id = m.contact_id
      left join public.contact_tables tf on tf.id = m.from_table_id
      left join public.contact_tables tt on tt.id = m.to_table_id
      where m.user_id = _space and m.created_at >= _since and m.source is distinct from 'scheduler'
        and (tt.system_key = 'meeting_scheduled' or tf.system_key = 'meeting_scheduled')
        and m.contact_id in (
          select m2.contact_id from public.contact_table_moves m2
          where m2.user_id = _space and m2.actor_id = _account and m2.created_at >= _since)
      order by m.created_at
      limit 1000
    ) q
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'call.logged', 'at', a.created_at, 'source_kind', 'activity',
      'source_id', a.id, 'subject_id', a.contact_id, 'did', true, 'on_record', true, 'tags', to_jsonb(c.tags),
      'note', case when _contacts then coalesce(nullif(btrim(c.company_name), ''),
                nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) end))
    from (select * from public.contact_activities a
          where a.user_id = _space and a.actor_id = _account and a.type = 'call' and a.created_at >= _since
          order by a.created_at limit 1000) a
    join public.contacts c on c.id = a.contact_id
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'contact.created', 'at', c.created_at, 'source_kind', 'contact',
      'source_id', c.id, 'subject_id', c.id, 'did', true, 'on_record', true, 'tags', to_jsonb(c.tags),
      'has_phone', nullif(btrim(coalesce(c.phone, '')), '') is not null,
      'has_email', nullif(btrim(coalesce(c.email, '')), '') is not null,
      'note', case when _contacts then coalesce(nullif(btrim(c.company_name), ''),
                nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) end))
    from (select * from public.contacts c
          where c.user_id = _space and c.created_by = _account and c.created_at >= _since
            and not c.is_demo and c.deleted_at is null
          order by c.created_at limit 1000) c
  ), '[]'::jsonb);

  -- Meetings: the scheduler, the calendar.
  _out := _out || coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object('event', 'meeting.booked', 'at', b.confirmed_at, 'source_kind', 'booking',
          'source_id', b.id, 'subject_id', b.id, 'via', 'scheduler', 'did', true, 'on_record', true,
          'note', case when _calendar then b.guest_company end) as x
      from public.bookings b
      where b.space_id = _space and b.host_user_id = _account and b.status = 'confirmed'
        and b.confirmed_at >= _since
      union all
      select jsonb_build_object('event', 'booking.received', 'at', b.created_at, 'source_kind', 'booking',
          'source_id', b.id, 'subject_id', b.id, 'did', true, 'on_record', true,
          'note', case when _calendar then b.guest_company end)
      from public.bookings b
      where b.space_id = _space and b.host_user_id = _account and b.status in ('pending', 'confirmed')
        and b.created_at >= _since
      union all
      select jsonb_build_object('event', 'meeting.held', 'at', b.ends_at, 'source_kind', 'booking',
          'source_id', b.id, 'subject_id', b.id, 'via', 'scheduler', 'did', true, 'on_record', true,
          'note', case when _calendar then b.guest_company end)
      from public.bookings b
      where b.space_id = _space and b.host_user_id = _account and b.status = 'confirmed'
        and b.no_show_at is null and b.ends_at >= _since and b.ends_at < now()
      union all
      select jsonb_build_object('event', 'meeting.booked', 'at', e.created_at, 'source_kind', 'calendar_event',
          'source_id', e.id, 'subject_id', coalesce(e.contact_id, e.id), 'via', 'calendar',
          'did', true, 'on_record', true, 'note', case when _calendar then e.title end)
      from public.calendar_events e
      where e.user_id = _space and e.actor_id = _account and e.kind = 'meeting' and e.source = 'manual'
        and not e.is_demo and e.created_at >= _since
      union all
      select jsonb_build_object('event', 'meeting.held', 'at', coalesce(e.ends_at, e.starts_at + interval '1 hour'),
          'source_kind', 'calendar_event', 'source_id', e.id, 'subject_id', e.id, 'via', 'calendar',
          'did', true, 'on_record', true, 'note', case when _calendar then e.title end)
      from public.calendar_events e
      where e.user_id = _space and e.actor_id = _account and e.kind = 'meeting'
        and e.source in ('manual', 'contact_move') and not e.is_demo and not e.all_day
        and coalesce(e.ends_at, e.starts_at + interval '1 hour') >= _since
        and coalesce(e.ends_at, e.starts_at + interval '1 hour') < now()
      limit 1000
    ) q
  ), '[]'::jsonb);

  -- Pipeline: moves between stages, deals won and lost.
  _out := _out || coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object('event', 'deal.moved', 'at', e.occurred_at, 'source_kind', 'deal_event',
          'source_id', e.id, 'subject_id', d.id, 'did', e.actor_id = _account,
          'on_record', _account = any (public.reward_deal_people(d.id)),
          'from_id', e.payload ->> 'from_stage_id', 'to_id', e.payload ->> 'to_stage_id',
          'value', coalesce(d.value, 0), 'currency', d.currency,
          'note', case when _pipeline then d.title end) as x
      from public.deal_events e
      join public.deals d on d.id = e.deal_id
      where e.user_id = _space and e.kind = 'stage' and e.occurred_at >= _since and not d.is_demo
        and (e.actor_id = _account or _account = any (public.reward_deal_people(d.id)))
      order by e.occurred_at
      limit 1000
    ) q
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object(
          'event', case when d.won_at is not null then 'deal.won' else 'deal.lost' end,
          'at', coalesce(d.won_at, d.lost_at), 'source_kind', 'deal', 'source_id', d.id, 'subject_id', d.id,
          'did', coalesce((
            select e.actor_id = _account from public.deal_events e
            where e.deal_id = d.id and e.kind = 'stage'
              and coalesce((e.payload ->> case when d.won_at is not null then 'won' else 'lost' end)::boolean, false)
            order by e.occurred_at desc limit 1), d.created_by = _account),
          'on_record', _account = any (public.reward_deal_people(d.id)),
          'value', coalesce(d.value, 0), 'currency', d.currency,
          'note', case when _pipeline then d.title end) as x
      from public.deals d
      where d.user_id = _space and not d.is_demo
        and coalesce(d.won_at, d.lost_at) >= _since
      order by coalesce(d.won_at, d.lost_at)
      limit 1000
    ) q
    where (x ->> 'did')::boolean or (x ->> 'on_record')::boolean
  ), '[]'::jsonb);

  -- Tasks: sales tasks (the person it is for, whoever ticked it off), tasks of milestones.
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'task.done', 'at', t.completed_at, 'source_kind', 'crm_task',
      'source_id', t.id, 'subject_id', t.id, 'did', t.completed_by = _account,
      'on_record', t.assignee_id = _account, 'task_kind', 'crm_task',
      'on_time', date_trunc('minute', t.completed_at) <= date_trunc('minute', t.due_at),
      'priced', t.reward_amount is not null, 'price', t.reward_amount, 'price_currency', t.reward_currency,
      'note', t.title))
    from (select * from public.crm_tasks t
          where t.user_id = _space and t.status = 'done' and t.completed_at >= _since and not t.is_demo
            and (t.assignee_id = _account or t.completed_by = _account)
          order by t.completed_at limit 1000) t
  ), '[]'::jsonb);
  _out := _out || coalesce((
    select jsonb_agg(jsonb_build_object('event', 'task.done', 'at', t.completed_at, 'source_kind', 'task',
      'source_id', t.id, 'subject_id', t.id, 'did', true, 'on_record', true, 'task_kind', 'task',
      'on_time', t.due_date is null or (t.completed_at at time zone _zone)::date <= t.due_date,
      'priced', t.reward_amount is not null, 'price', t.reward_amount, 'price_currency', t.reward_currency,
      'note', t.title))
    from (select * from public.tasks t
          where t.user_id = _space and t.status = 'done' and t.completed_by = _account
            and t.completed_at >= _since and not t.is_demo
          order by t.completed_at limit 1000) t
  ), '[]'::jsonb);

  -- Invoices of the worker's deals (who issued one is not kept).
  _out := _out || coalesce((
    select jsonb_agg(x)
    from (
      select jsonb_build_object('event', 'invoice.issued', 'at', (i.issued_on + time '12:00') at time zone _zone,
          'source_kind', 'invoice', 'source_id', i.id, 'subject_id', i.id, 'did', false, 'on_record', true,
          'value', i.subtotal, 'currency', i.currency, 'note', case when _finance then i.number end) as x
      from public.invoices i
      where i.user_id = _space and i.kind = 'invoice' and i.cancelled_at is null and i.deal_id is not null
        and i.issued_on >= (_since at time zone _zone)::date
        and _account = any (public.reward_deal_people(i.deal_id))
      union all
      select jsonb_build_object('event', 'invoice.paid', 'at', (i.paid_on + time '12:00') at time zone _zone,
          'source_kind', 'invoice', 'source_id', i.id, 'subject_id', i.id, 'did', false, 'on_record', true,
          'value', i.subtotal, 'currency', i.currency, 'note', case when _finance then i.number end)
      from public.invoices i
      where i.user_id = _space and i.kind = 'invoice' and i.cancelled_at is null and i.deal_id is not null
        and i.paid_on >= (_since at time zone _zone)::date
        and _account = any (public.reward_deal_people(i.deal_id))
      limit 1000
    ) q
  ), '[]'::jsonb);
  return _out;
end;
$$;
revoke execute on function public.reward_history(uuid, integer) from public, anon;
grant execute on function public.reward_history(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. The invite shows the worker's rules with the names of their tables
-- -----------------------------------------------------------------------------

create or replace function public.my_worker_invites(_user uuid default null)
returns table (
  invite_id uuid,
  space_id uuid,
  company_name text,
  logo_url text,
  owner_name text,
  job_title text,
  grants jsonb,
  rewards jsonb,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.owner_id,
    coalesce(p.company_name, ip.name),
    p.company_logo_url,
    p.display_name,
    w.job_title,
    coalesce((
      select jsonb_agg(jsonb_build_object('section', g.section, 'action', g.action, 'allowed', g.allowed)
                       order by g.section, g.action)
      from public.worker_permission_grants g
      where g.worker_id = w.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'definition', r.definition, 'currency', rp.currency,
               'names', coalesce((
                 select jsonb_object_agg(n.id, n.name)
                 from (
                   select t.id::text as id, t.name from public.contact_tables t where t.user_id = i.owner_id
                   union all
                   select s.id::text, s.name from public.pipeline_stages s where s.user_id = i.owner_id
                 ) n
                 where (r.definition -> 'event' -> 'from' -> 'ids') ? n.id
                    or (r.definition -> 'event' -> 'to' -> 'ids') ? n.id
               ), '{}'::jsonb))
             order by r.position, r.created_at)
      from public.reward_plan_rules r
      join public.reward_plans rp on rp.id = r.plan_id
      where rp.worker_id = w.id and r.active
    ), '[]'::jsonb),
    i.expires_at,
    i.created_at
  from public.worker_invites i
  join public.workers w on w.id = i.worker_id and w.owner_id = i.owner_id
  left join public.profiles p on p.id = i.owner_id
  left join public.invoice_profiles ip on ip.user_id = i.owner_id
  where i.invitee_id = coalesce(auth.uid(), _user)
    and i.accepted_at is null
    and i.declined_at is null
    and i.replaced_at is null
    and i.expires_at > now()
    and w.status = 'invited'
    and w.user_id is null
  order by i.created_at desc
  limit 20;
$$;

-- -----------------------------------------------------------------------------
-- 10. Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('reward_rule_tried', 'workers', true),
  ('reward_rules_stacked', 'workers', true),
  ('reward_setup_suggested', 'workers', true),
  ('reward_setup_applied', 'workers', true)
on conflict (event) do nothing;
