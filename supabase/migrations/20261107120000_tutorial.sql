-- =============================================================================
-- Tutorial (step 20.4): none, a quick look, or the full hands-on tutorial
--   * profiles.tutorial: the choice and the progress as JSON (mode, step,
--     started_at, updated_at, finished_at, outcome, demo), written by the
--     client on its own row, shape checked by valid_tutorial_state()
--   * is_demo on contacts, deals, milestones, tasks, crm_tasks,
--     calendar_events and notes: sample data of the full tutorial. Only
--     tutorial_seed_demo() sets it (demo_flag_guard keeps the client out);
--     tutorial_delete_demo() removes every sample row and what hangs only on it
--   * sample rows earn no XP, count for no badge, unlock no section and stay
--     out of the money metrics; a finished tutorial earns XP once per kind
--     (award_xp 'tutorial_completed': quick 25, full 100)
--   * the analytics catalog gets tutorial_started / _step / _finished /
--     _abandoned
-- Additive only: new nullable or defaulted columns, new functions, and the
-- named functions replaced with the same signatures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The choice and the progress
-- -----------------------------------------------------------------------------

create or replace function public.valid_tutorial_state(_state jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _state is null or (
    jsonb_typeof(_state) = 'object'
    and octet_length(_state::text) <= 1000
    and (_state ->> 'mode') in ('none', 'quick', 'full')
    and (_state -> 'step' is null or jsonb_typeof(_state -> 'step') in ('string', 'null'))
    and coalesce(_state ->> 'step', '') ~ '^[A-Za-z0-9_]{0,60}$'
    and (_state ->> 'outcome' is null or _state ->> 'outcome' in ('finished', 'skipped', 'abandoned'))
    and (_state ->> 'demo' is null or _state ->> 'demo' in ('kept', 'deleted'))
    and coalesce(_state ->> 'started_at', '2000-01-01T') ~ '^\d{4}-\d{2}-\d{2}T'
    and coalesce(_state ->> 'updated_at', '2000-01-01T') ~ '^\d{4}-\d{2}-\d{2}T'
    and coalesce(_state ->> 'finished_at', '2000-01-01T') ~ '^\d{4}-\d{2}-\d{2}T'
  );
$$;

alter table public.profiles
  add column tutorial jsonb check (public.valid_tutorial_state(tutorial));

comment on column public.profiles.tutorial is
  'The tutorial the user chose (none | quick | full) and how far they got: step key, started_at, updated_at, finished_at, outcome (finished | skipped | abandoned), demo (kept | deleted). Written by the client.';

-- -----------------------------------------------------------------------------
-- Sample data of the full tutorial
-- -----------------------------------------------------------------------------

alter table public.contacts add column is_demo boolean not null default false;
alter table public.deals add column is_demo boolean not null default false;
alter table public.milestones add column is_demo boolean not null default false;
alter table public.tasks add column is_demo boolean not null default false;
alter table public.crm_tasks add column is_demo boolean not null default false;
alter table public.calendar_events add column is_demo boolean not null default false;
alter table public.notes add column is_demo boolean not null default false;

create index contacts_demo_idx on public.contacts (user_id) where is_demo;
create index deals_demo_idx on public.deals (user_id) where is_demo;
create index milestones_demo_idx on public.milestones (user_id) where is_demo;
create index tasks_demo_idx on public.tasks (user_id) where is_demo;
create index crm_tasks_demo_idx on public.crm_tasks (user_id) where is_demo;
create index calendar_events_demo_idx on public.calendar_events (user_id) where is_demo;
create index notes_demo_idx on public.notes (user_id) where is_demo;

-- The flag is the server's: a client row is never a sample, and a sample stays one.
create or replace function public.demo_flag_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.is_demo := false;
    else
      new.is_demo := old.is_demo;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.demo_flag_guard() from public, anon, authenticated;

do $$
declare
  _table text;
begin
  foreach _table in array array[
    'contacts', 'deals', 'milestones', 'tasks', 'crm_tasks', 'calendar_events', 'notes'
  ] loop
    execute format(
      'create trigger demo_flag_guard before insert or update on public.%I
         for each row execute function public.demo_flag_guard()',
      _table
    );
  end loop;
end;
$$;

-- The contact list shows the sample label too.
create or replace view public.contact_list
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.phone_normalized,
  c.city,
  c.source,
  c.created_at,
  concat_ws(' ', c.company_name, c.first_name, c.last_name) as search_name,
  e.table_id,
  (
    select max(a.occurred_at)
    from public.contact_activities a
    where a.contact_id = c.id and a.occurred_at <= now()
  ) as last_contact_at,
  c.website,
  c.user_id,
  c.is_demo
from public.contacts c
left join public.contact_table_entries e
  on e.contact_id = c.id and e.user_id = c.user_id;

-- A trimmed text of the payload, null when empty.
create or replace function public.tutorial_text(_value jsonb, _max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(case when jsonb_typeof(_value) = 'string' then _value #>> '{}' end), _max), '');
$$;
revoke execute on function public.tutorial_text(jsonb, integer) from public, anon, authenticated;

-- An instant of the payload, only within a few months of now.
create or replace function public.tutorial_instant(_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  _at timestamptz;
begin
  if _value is null or jsonb_typeof(_value) <> 'string' then
    return null;
  end if;
  begin
    _at := (_value #>> '{}')::timestamptz;
  exception when others then
    return null;
  end;
  if _at < now() - interval '90 days' or _at > now() + interval '90 days' then
    return null;
  end if;
  return _at;
end;
$$;
revoke execute on function public.tutorial_instant(jsonb) from public, anon, authenticated;

/*
 * Puts the sample data of the full tutorial into the caller's own space:
 * up to 3 contacts (they land in the unreached table like any new contact),
 * one deal on the first open stage with the first contact, one milestone with
 * up to 5 tasks and their subtasks, up to 2 sales tasks, one meeting and one
 * note. The words come from the app (the user's language and branch); the
 * flag, the owner and the links are set here. A second call while samples
 * exist adds nothing.
 */
create or replace function public.tutorial_seed_demo(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _item jsonb;
  _child jsonb;
  _id uuid;
  _contacts uuid[] := '{}';
  _stage uuid;
  _deal uuid;
  _milestone uuid;
  _task uuid;
  _note uuid;
  _currency text;
  _position integer := 0;
  _child_position integer;
  _due timestamptz;
  _starts timestamptz;
  _value numeric;
  _close date;
  _content jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if public.current_workspace_id() is distinct from _uid then
    raise exception 'tutorial_owner_only' using errcode = 'insufficient_privilege';
  end if;
  if _payload is null or jsonb_typeof(_payload) <> 'object' or octet_length(_payload::text) > 200000 then
    raise exception 'tutorial_payload_invalid' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('tutorial_demo:' || _uid::text));

  if exists (select 1 from public.contacts where user_id = _uid and is_demo)
     or exists (select 1 from public.deals where user_id = _uid and is_demo)
     or exists (select 1 from public.milestones where user_id = _uid and is_demo)
     or exists (select 1 from public.notes where user_id = _uid and is_demo)
  then
    return jsonb_build_object(
      'created', false,
      'seeded_at', coalesce(
        (select min(created_at) from public.contacts where user_id = _uid and is_demo),
        (select min(created_at) from public.milestones where user_id = _uid and is_demo),
        _now
      )
    );
  end if;

  select coalesce(s.currency, 'CZK') into _currency from public.user_settings s where s.user_id = _uid;
  _currency := coalesce(_currency, 'CZK');

  -- Contacts
  for _item in
    select value from jsonb_array_elements(
      case when jsonb_typeof(_payload -> 'contacts') = 'array' then _payload -> 'contacts' else '[]'::jsonb end
    ) limit 3
  loop
    insert into public.contacts (user_id, first_name, last_name, company_name, email, city, source, is_demo)
    values (
      _uid,
      public.tutorial_text(_item -> 'first_name', 100),
      public.tutorial_text(_item -> 'last_name', 100),
      public.tutorial_text(_item -> 'company_name', 200),
      public.tutorial_text(_item -> 'email', 200),
      public.tutorial_text(_item -> 'city', 100),
      'manual',
      true
    )
    returning id into _id;
    _contacts := _contacts || _id;
  end loop;

  -- The deal, on the first stage that is neither won nor lost
  select st.id into _stage
  from public.pipeline_stages st
  where st.user_id = _uid and not st.is_won and not st.is_lost
  order by st.position
  limit 1;
  if _stage is not null and public.tutorial_text(_payload #> '{deal,title}', 200) is not null then
    _value := case when jsonb_typeof(_payload #> '{deal,value}') = 'number'
      then least(greatest((_payload #>> '{deal,value}')::numeric, 0), 1000000000) end;
    begin
      _close := (_payload #>> '{deal,expected_close_date}')::date;
    exception when others then
      _close := null;
    end;
    if _close is not null and abs(_close - current_date) > 365 then
      _close := null;
    end if;
    insert into public.deals (
      user_id, stage_id, title, value, currency, expected_close_date, contact_id,
      created_by, assignee_id, position, is_demo
    )
    values (
      _uid, _stage, public.tutorial_text(_payload #> '{deal,title}', 200), _value, _currency, _close,
      _contacts[1], _uid, _uid,
      coalesce((select max(d.position) + 1 from public.deals d where d.user_id = _uid and d.stage_id = _stage), 0),
      true
    )
    returning id into _deal;
  end if;

  -- The milestone with its tasks
  if public.tutorial_text(_payload #> '{milestone,title}', 200) is not null then
    insert into public.milestones (user_id, title, description, category, position, is_demo)
    values (
      _uid,
      public.tutorial_text(_payload #> '{milestone,title}', 200),
      public.tutorial_text(_payload #> '{milestone,description}', 2000),
      'work',
      coalesce((select max(m.position) + 1 from public.milestones m where m.user_id = _uid), 0),
      true
    )
    returning id into _milestone;

    for _item in
      select value from jsonb_array_elements(
        case when jsonb_typeof(_payload #> '{milestone,tasks}') = 'array'
          then _payload #> '{milestone,tasks}' else '[]'::jsonb end
      ) limit 5
    loop
      continue when public.tutorial_text(_item -> 'title', 200) is null;
      insert into public.tasks (user_id, milestone_id, title, status, position, is_demo)
      values (_uid, _milestone, public.tutorial_text(_item -> 'title', 200), 'todo', _position, true)
      returning id into _task;
      _position := _position + 1;
      _child_position := 0;
      for _child in
        select value from jsonb_array_elements(
          case when jsonb_typeof(_item -> 'children') = 'array' then _item -> 'children' else '[]'::jsonb end
        ) limit 3
      loop
        continue when public.tutorial_text(_child, 200) is null;
        insert into public.tasks (user_id, milestone_id, parent_task_id, title, status, position, is_demo)
        values (_uid, _milestone, _task, public.tutorial_text(_child, 200), 'todo', _child_position, true);
        _child_position := _child_position + 1;
      end loop;
    end loop;
  end if;

  -- Sales tasks: the first on the deal, the next on the second contact
  _position := 0;
  for _item in
    select value from jsonb_array_elements(
      case when jsonb_typeof(_payload -> 'crm_tasks') = 'array' then _payload -> 'crm_tasks' else '[]'::jsonb end
    ) limit 2
  loop
    _due := public.tutorial_instant(_item -> 'due_at');
    _position := _position + 1;
    continue when _due is null or public.tutorial_text(_item -> 'title', 200) is null;
    continue when (_position = 1 and _deal is null) or (_position = 2 and _contacts[2] is null);
    insert into public.crm_tasks (
      user_id, title, due_at, duration_minutes, assignee_id, created_by, deal_id, contact_id, is_demo
    )
    values (
      _uid,
      public.tutorial_text(_item -> 'title', 200),
      _due,
      case when jsonb_typeof(_item -> 'duration_minutes') = 'number'
        then least(greatest((_item ->> 'duration_minutes')::integer, 1), 1440) else 15 end,
      _uid,
      _uid,
      case when _position = 1 then _deal end,
      case when _position = 2 then _contacts[2] end,
      true
    );
  end loop;

  -- The meeting with the first contact about the deal
  _starts := public.tutorial_instant(_payload #> '{meeting,starts_at}');
  if _starts is not null and public.tutorial_text(_payload #> '{meeting,title}', 200) is not null then
    insert into public.calendar_events (
      user_id, actor_id, title, kind, starts_at, ends_at, all_day, contact_id, deal_id, is_demo
    )
    values (
      _uid, _uid, public.tutorial_text(_payload #> '{meeting,title}', 200), 'meeting',
      _starts, _starts + interval '1 hour', false, _contacts[1], _deal, true
    );
  end if;

  -- The note (a text note: a Tiptap document)
  _content := _payload #> '{note,content}';
  if public.tutorial_text(_payload #> '{note,title}', 200) is not null
     and jsonb_typeof(_content) = 'object' and _content ->> 'type' = 'doc'
  then
    insert into public.notes (user_id, title, content, content_text, kind, is_demo)
    values (
      _uid,
      public.tutorial_text(_payload #> '{note,title}', 200),
      _content,
      left(coalesce(_payload #>> '{note,content_text}', ''), 100000),
      'text',
      true
    )
    returning id into _note;
  end if;

  return jsonb_build_object(
    'created', true,
    'seeded_at', _now,
    'contacts', to_jsonb(_contacts),
    'deal', _deal,
    'milestone', _milestone,
    'note', _note
  );
end;
$$;
revoke execute on function public.tutorial_seed_demo(jsonb) from public, anon;
grant execute on function public.tutorial_seed_demo(jsonb) to authenticated;

/*
 * "Delete the sample data": every sample row of the caller's own space and
 * what only hangs on it — drafts of invoices for a sample deal or contact,
 * events and sales tasks linked to nothing else (deleting a sample deal or
 * contact detaches the rest as it always does). Issued invoices are records
 * and stay. Returns how many sample rows went.
 */
create or replace function public.tutorial_delete_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _deals uuid[];
  _contacts uuid[];
  _count integer;
  _total integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if public.current_workspace_id() is distinct from _uid then
    raise exception 'tutorial_owner_only' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtext('tutorial_demo:' || _uid::text));

  select coalesce(array_agg(d.id), '{}') into _deals
  from public.deals d where d.user_id = _uid and d.is_demo;
  select coalesce(array_agg(c.id), '{}') into _contacts
  from public.contacts c where c.user_id = _uid and c.is_demo;

  delete from public.invoices i
  where i.user_id = _uid and i.status = 'draft'
    and (i.deal_id = any(_deals) or i.contact_id = any(_contacts));

  delete from public.calendar_events e
  where e.user_id = _uid and e.source <> 'deal_deadline'
    and (
      e.is_demo
      or (e.deal_id = any(_deals) and (e.contact_id is null or e.contact_id = any(_contacts)))
      or (e.contact_id = any(_contacts) and e.deal_id is null)
    );
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.crm_tasks t where t.user_id = _uid and t.is_demo;
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.deals d where d.user_id = _uid and d.is_demo;
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.contacts c where c.user_id = _uid and c.is_demo;
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.tasks t where t.user_id = _uid and t.is_demo and t.parent_task_id is null;
  delete from public.tasks t where t.user_id = _uid and t.is_demo;
  delete from public.milestones m where m.user_id = _uid and m.is_demo;
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.notes n where n.user_id = _uid and n.is_demo;
  get diagnostics _count = row_count;
  _total := _total + _count;

  return jsonb_build_object('deleted', _total);
end;
$$;
revoke execute on function public.tutorial_delete_demo() from public, anon;
grant execute on function public.tutorial_delete_demo() to authenticated;

-- -----------------------------------------------------------------------------
-- Game: a finished tutorial earns XP once; samples earn and count for nothing
-- -----------------------------------------------------------------------------

alter table public.xp_events drop constraint xp_events_kind_check;
alter table public.xp_events add constraint xp_events_kind_check check (kind in (
  'task_completed', 'milestone_completed', 'deal_won', 'meeting_booked', 'contact_moved',
  'contact_generated', 'call_30min', 'calendar_event', 'transaction_added', 'daily_login',
  'tutorial_completed',
  -- legacy (step 6.1/6.2), kept so earlier XP still counts
  'section_unlocked', 'prospecting_record', 'contacts_generated_first', 'meeting_tenth',
  'onboarding_completed'
));

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
  _tutorial jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _reason is null or _reason not in (
    'task_completed', 'milestone_completed', 'deal_won', 'meeting_booked', 'contact_moved',
    'contact_generated', 'call_30min', 'calendar_event', 'transaction_added', 'daily_login',
    'tutorial_completed'
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
      where t.id = _ref and t.user_id = _uid and t.status = 'done' and not t.is_demo
        and (t.completed_by is null or t.completed_by = _uid);
      if _id is not null then
        _gained := public.game_grant(_uid, 'task_completed', _id::text, _xp, _day_start);
      end if;

    when 'milestone_completed' then
      select m.id, m.template_id, m.completed_at, pm.xp as template_xp, pm.unlock_key
      into _milestone
      from public.milestones m
      left join public.path_milestones pm on pm.id = m.template_id
      where m.id = _ref and m.user_id = _uid and m.status = 'completed' and not m.is_demo;
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
      where d.id = _ref and d.user_id = _uid and d.won_at is not null and not d.is_demo;
      if _id is not null then
        _gained := public.game_grant(_uid, 'deal_won', _id::text, _xp, _day_start);
      end if;

    when 'meeting_booked', 'calendar_event' then
      select e.id into _id
      from public.calendar_events e
      where e.user_id = _uid and coalesce(e.actor_id, _uid) = _uid and not e.is_demo
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
        and not exists (
          select 1 from public.contacts c where c.id = m.contact_id and c.is_demo
        )
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

    when 'tutorial_completed' then
      -- Once per kind of tutorial, and only when the profile says it was finished.
      select p.tutorial into _tutorial from public.profiles p where p.id = _uid;
      if _tutorial ->> 'outcome' = 'finished'
         and _tutorial ->> 'mode' in ('quick', 'full')
         and _tutorial ->> 'finished_at' is not null
      then
        _gained := public.game_grant(
          _uid, 'tutorial_completed', 'tutorial:' || (_tutorial ->> 'mode'),
          case when _tutorial ->> 'mode' = 'full' then 100 else 25 end, _day_start
        );
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
    where m.user_id = _uid and m.completed_at is not null and not m.is_demo
  ),
  chapters as (
    select path.chapter, bool_and(path.key in (select key from done)) as complete
    from path group by path.chapter
  )
  select count(*)::integer, (count(*) filter (where complete))::integer
  into _chapters, _chapters_done
  from chapters;

  return jsonb_build_object(
    'tasks_done', (select count(*) from public.tasks where user_id = _uid and status = 'done' and not is_demo),
    'milestones_completed',
      (select count(*) from public.milestones where user_id = _uid and completed_at is not null and not is_demo),
    'contacts', (select count(*) from public.contacts where user_id = _uid and not is_demo),
    'call_seconds', (
      select coalesce(sum(extract(epoch from public.prospecting_effective_end(s) - s.started_at)), 0)::bigint
      from public.prospecting_segments s
      where s.user_id = _uid and coalesce(s.actor_id, _uid) = _uid
    ),
    'deals_won', (select count(*) from public.deals where user_id = _uid and won_at is not null and not is_demo),
    'streak', (select g.streak from public.game_streak(_uid, _tz) g),
    'task_depth', (
      with recursive tree as (
        select t.id, 1 as depth from public.tasks t
        where t.user_id = _uid and t.parent_task_id is null and not t.is_demo
        union all
        select t.id, tree.depth + 1 from public.tasks t
        join tree on t.parent_task_id = tree.id
        where tree.depth < 10
      )
      select coalesce(max(depth), 0) from tree
    ),
    'calendar_events', (select count(*) from public.calendar_events where user_id = _uid and not is_demo),
    'meetings', (select count(*) from public.calendar_events where user_id = _uid and kind = 'meeting' and not is_demo),
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

-- Switching to game mode keeps open what the account really uses, not the samples.
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
      ('section_contacts', exists (select 1 from public.contacts where user_id = _uid and not is_demo)),
      ('section_cold_calling', exists (select 1 from public.prospecting_segments where user_id = _uid)),
      ('section_pipeline', exists (select 1 from public.deals where user_id = _uid and not is_demo)),
      ('section_calendar', exists (select 1 from public.calendar_events where user_id = _uid and not is_demo)),
      ('section_finance', exists (select 1 from public.transactions where user_id = _uid)
                          or exists (select 1 from public.invoices where user_id = _uid)),
      ('section_workers', exists (select 1 from public.workers where owner_id = _uid))
  ) as s(key, used)
  where s.used
  on conflict (user_id, key) do nothing;
$$;

-- -----------------------------------------------------------------------------
-- Metrics: money of sample deals is not money
-- -----------------------------------------------------------------------------

create or replace function public.metric_money_by_currency(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (metric text, currency text, items bigint, total numeric, average numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select m.metric, m.currency, count(*), coalesce(sum(m.amount), 0), round(avg(m.amount), 2)
  from (
    select 'deals_created'::text as metric, d.currency, d.value as amount
    from public.deals d
    where d.user_id = any(_users) and not d.is_demo and d.created_at >= _start and d.created_at < _end
    union all
    select 'deals_won', d.currency, d.value
    from public.deals d
    where d.user_id = any(_users) and not d.is_demo and d.won_at >= _start and d.won_at < _end
    union all
    select 'deals_lost', d.currency, d.value
    from public.deals d
    where d.user_id = any(_users) and not d.is_demo and d.lost_at >= _start and d.lost_at < _end
    union all
    select case t.type when 'income' then 'income' else 'expense' end, t.currency, t.amount
    from public.transactions t
    where t.user_id = any(_users) and t.occurred_on between _from and _to
    union all
    select 'invoices_issued', i.currency, i.amount
    from public.invoices i
    where i.user_id = any(_users) and i.issued_on between _from and _to
      and i.status not in ('draft', 'cancelled')
  ) m
  group by m.metric, m.currency
  order by m.metric, m.currency;
end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('tutorial_started', 'onboarding', false),
  ('tutorial_step', 'onboarding', false),
  ('tutorial_finished', 'onboarding', false),
  ('tutorial_abandoned', 'onboarding', false)
on conflict (event) do nothing;
