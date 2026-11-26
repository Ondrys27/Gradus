-- =============================================================================
-- Rights before the invite and a tutorial by rights (step 30.2)
--   * space_tutorials: a worker's tutorial in each company they work for (the
--     choice and progress as in profiles.tutorial, valid_tutorial_state()) and
--     the sections they were introduced to there (known_sections), so Grady
--     offers a short look at sections opened to them later, once. The
--     account's own space keeps profiles.tutorial. Each person their own rows,
--     only in companies they are an active member of.
--   * tutorial_seed_worker_demo(): the full tutorial's sample data in the
--     company, only in the sections the worker's rights open, the deal, tasks
--     and meeting theirs; tutorial_demo_rows (server only) remembers which rows
--     they were, tutorial_delete_worker_demo() removes exactly those.
--   * tutorial_seed_demo() of the owner no longer counts a worker's samples as
--     its own (same signature, same body otherwise).
-- The invite itself needs nothing new: rights, widgets, dashboard and reward
-- plan are rows of the worker record made before the invite (row level
-- security of each table), my_worker_invites() already returns the rights.
-- Additive only: new tables and functions, one function replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A worker's tutorial per company
-- -----------------------------------------------------------------------------

create table public.space_tutorials (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  state jsonb check (public.valid_tutorial_state(state)),
  known_sections text[] check (
    known_sections is null
    or (
      cardinality(known_sections) <= 40
      and array_to_string(known_sections, ',') ~ '^([A-Za-z_]{1,40}(,[A-Za-z_]{1,40})*)?$'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, space_id),
  constraint space_tutorials_foreign_space check (user_id <> space_id)
);
comment on table public.space_tutorials is
  'A worker''s tutorial in a company they work for (30.2): state as profiles.tutorial, known_sections = the menu sections they were introduced to there. Written by the person themself.';

create trigger space_tutorials_updated_at
  before update on public.space_tutorials
  for each row execute function public.set_updated_at();

alter table public.space_tutorials enable row level security;

create policy space_tutorials_select on public.space_tutorials
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
create policy space_tutorials_insert on public.space_tutorials
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and space_id <> (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
create policy space_tutorials_update on public.space_tutorials
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  )
  with check (
    user_id = (select auth.uid())
    and space_id <> (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );

revoke all on public.space_tutorials from anon, authenticated;
grant select, insert, update on public.space_tutorials to authenticated;

-- -----------------------------------------------------------------------------
-- Which sample rows a worker's tutorial made (server only)
-- -----------------------------------------------------------------------------

create table public.tutorial_demo_rows (
  space_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'contacts', 'deals', 'milestones', 'tasks', 'crm_tasks', 'calendar_events', 'notes'
  )),
  row_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (kind, row_id)
);
comment on table public.tutorial_demo_rows is
  'Sample rows a worker''s full tutorial put into a company (30.2), so exactly those go again. Only the tutorial functions read and write it.';
create index tutorial_demo_rows_person_idx on public.tutorial_demo_rows (space_id, user_id);

alter table public.tutorial_demo_rows enable row level security;
revoke all on public.tutorial_demo_rows from anon, authenticated;

-- -----------------------------------------------------------------------------
-- The owner's sample data: a worker's samples are not theirs
-- -----------------------------------------------------------------------------

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

  -- Samples a worker's tutorial put into this company are theirs, not the owner's (30.2).
  if exists (select 1 from public.contacts c where c.user_id = _uid and c.is_demo
               and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'contacts' and r.row_id = c.id))
     or exists (select 1 from public.deals d where d.user_id = _uid and d.is_demo
               and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'deals' and r.row_id = d.id))
     or exists (select 1 from public.milestones m where m.user_id = _uid and m.is_demo
               and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'milestones' and r.row_id = m.id))
     or exists (select 1 from public.notes n where n.user_id = _uid and n.is_demo
               and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'notes' and r.row_id = n.id))
  then
    return jsonb_build_object(
      'created', false,
      'seeded_at', coalesce(
        (select min(c.created_at) from public.contacts c where c.user_id = _uid and c.is_demo
           and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'contacts' and r.row_id = c.id)),
        (select min(m.created_at) from public.milestones m where m.user_id = _uid and m.is_demo
           and not exists (select 1 from public.tutorial_demo_rows r where r.kind = 'milestones' and r.row_id = m.id)),
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

-- The worker of the active company, or an error: their samples only go where they work.
create or replace function public.tutorial_worker_space()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid := public.current_workspace_id();
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _space is null or _space = _uid or not exists (
    select 1 from public.memberships m
    where m.user_id = _uid and m.space_id = _space and m.role = 'worker' and m.status = 'active'
  ) then
    raise exception 'tutorial_worker_only' using errcode = 'insufficient_privilege';
  end if;
  return _space;
end;
$$;
revoke execute on function public.tutorial_worker_space() from public, anon, authenticated;

/*
 * The full tutorial of a worker (30.2): the same sample data as the owner's,
 * put into the company they work in, but only in the sections their rights
 * open there — contacts (Contacts or Cold Calling), a deal they are on
 * (Pipeline), a milestone with tasks (Milestones), sales tasks given to them
 * on a sample deal or contact, a meeting of theirs (Calendar) — and a note of
 * their own. Every row is marked and remembered, so the end removes exactly
 * these. A second call while they exist adds nothing.
 */
create or replace function public.tutorial_seed_worker_demo(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid := public.tutorial_worker_space();
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
  _target_deal uuid;
  _target_contact uuid;
  _sections text[] := '{}';
  _contacts_open boolean := public.has_section_access(_space, 'contacts', 'view')
    or public.has_section_access(_space, 'cold_calling', 'view');
  _pipeline_open boolean := public.has_section_access(_space, 'pipeline', 'view');
  _milestones_open boolean := public.has_section_access(_space, 'milestones', 'view');
  _calendar_open boolean := public.has_section_access(_space, 'calendar', 'view');
begin
  if _payload is null or jsonb_typeof(_payload) <> 'object' or octet_length(_payload::text) > 200000 then
    raise exception 'tutorial_payload_invalid' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('tutorial_demo:' || _space::text || ':' || _uid::text));

  if exists (
    select 1 from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and (
      (r.kind = 'contacts' and exists (select 1 from public.contacts c where c.id = r.row_id))
      or (r.kind = 'deals' and exists (select 1 from public.deals d where d.id = r.row_id))
      or (r.kind = 'milestones' and exists (select 1 from public.milestones m where m.id = r.row_id))
      or (r.kind = 'notes' and exists (select 1 from public.notes n where n.id = r.row_id))
    )
  ) then
    return jsonb_build_object(
      'created', false,
      'seeded_at', coalesce(
        (select min(r.created_at) from public.tutorial_demo_rows r where r.space_id = _space and r.user_id = _uid),
        _now
      )
    );
  end if;
  -- What is left of an earlier run (the owner deleted the samples) is forgotten.
  delete from public.tutorial_demo_rows r where r.space_id = _space and r.user_id = _uid;

  select s.currency into _currency from public.user_settings s where s.user_id = _space;
  _currency := coalesce(_currency, 'CZK');

  -- Contacts, where Contacts or Cold Calling is open to them
  if _contacts_open then
    _sections := array_append(_sections, 'contacts');
    for _item in
      select value from jsonb_array_elements(
        case when jsonb_typeof(_payload -> 'contacts') = 'array' then _payload -> 'contacts' else '[]'::jsonb end
      ) limit 3
    loop
      insert into public.contacts (user_id, first_name, last_name, company_name, email, city, source, created_by, is_demo)
      values (
        _space,
        public.tutorial_text(_item -> 'first_name', 100),
        public.tutorial_text(_item -> 'last_name', 100),
        public.tutorial_text(_item -> 'company_name', 200),
        public.tutorial_text(_item -> 'email', 200),
        public.tutorial_text(_item -> 'city', 100),
        'manual',
        _uid,
        true
      )
      returning id into _id;
      _contacts := _contacts || _id;
      insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'contacts', _id);
    end loop;
  end if;

  -- A deal they are on, on the company's first open stage
  if _pipeline_open then
    select st.id into _stage
    from public.pipeline_stages st
    where st.user_id = _space and not st.is_won and not st.is_lost
    order by st.position
    limit 1;
  end if;
  if _stage is not null and public.tutorial_text(_payload #> '{deal,title}', 200) is not null then
    _sections := array_append(_sections, 'pipeline');
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
      _space, _stage, public.tutorial_text(_payload #> '{deal,title}', 200), _value, _currency, _close,
      _contacts[1], _uid, _uid,
      coalesce((select max(d.position) + 1 from public.deals d where d.user_id = _space and d.stage_id = _stage), 0),
      true
    )
    returning id into _deal;
    insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'deals', _deal);
  end if;

  -- The milestone with its tasks, where Milestones are open to them
  if _milestones_open and public.tutorial_text(_payload #> '{milestone,title}', 200) is not null then
    _sections := array_append(_sections, 'milestones');
    insert into public.milestones (user_id, title, description, category, position, is_demo)
    values (
      _space,
      public.tutorial_text(_payload #> '{milestone,title}', 200),
      public.tutorial_text(_payload #> '{milestone,description}', 2000),
      'work',
      coalesce((select max(m.position) + 1 from public.milestones m where m.user_id = _space), 0),
      true
    )
    returning id into _milestone;
    insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'milestones', _milestone);

    for _item in
      select value from jsonb_array_elements(
        case when jsonb_typeof(_payload #> '{milestone,tasks}') = 'array'
          then _payload #> '{milestone,tasks}' else '[]'::jsonb end
      ) limit 5
    loop
      continue when public.tutorial_text(_item -> 'title', 200) is null;
      insert into public.tasks (user_id, milestone_id, title, status, position, is_demo)
      values (_space, _milestone, public.tutorial_text(_item -> 'title', 200), 'todo', _position, true)
      returning id into _task;
      insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'tasks', _task);
      _position := _position + 1;
      _child_position := 0;
      for _child in
        select value from jsonb_array_elements(
          case when jsonb_typeof(_item -> 'children') = 'array' then _item -> 'children' else '[]'::jsonb end
        ) limit 3
      loop
        continue when public.tutorial_text(_child, 200) is null;
        insert into public.tasks (user_id, milestone_id, parent_task_id, title, status, position, is_demo)
        values (_space, _milestone, _task, public.tutorial_text(_child, 200), 'todo', _child_position, true)
        returning id into _id;
        insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'tasks', _id);
        _child_position := _child_position + 1;
      end loop;
    end loop;
  end if;

  -- Sales tasks given to them: the first on the deal (else the first contact), the next on the second contact
  _position := 0;
  for _item in
    select value from jsonb_array_elements(
      case when jsonb_typeof(_payload -> 'crm_tasks') = 'array' then _payload -> 'crm_tasks' else '[]'::jsonb end
    ) limit 2
  loop
    _due := public.tutorial_instant(_item -> 'due_at');
    _position := _position + 1;
    _target_deal := case when _position = 1 then _deal end;
    _target_contact := case
      when _position = 1 and _deal is null then _contacts[1]
      when _position = 2 then _contacts[2]
    end;
    continue when _due is null or public.tutorial_text(_item -> 'title', 200) is null;
    continue when _target_deal is null and _target_contact is null;
    insert into public.crm_tasks (
      user_id, title, due_at, duration_minutes, assignee_id, created_by, deal_id, contact_id, is_demo
    )
    values (
      _space,
      public.tutorial_text(_item -> 'title', 200),
      _due,
      case when jsonb_typeof(_item -> 'duration_minutes') = 'number'
        then least(greatest((_item ->> 'duration_minutes')::integer, 1), 1440) else 15 end,
      _uid,
      _uid,
      _target_deal,
      _target_contact,
      true
    )
    returning id into _id;
    insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'crm_tasks', _id);
  end loop;

  -- Their meeting, where the Calendar is open to them
  _starts := public.tutorial_instant(_payload #> '{meeting,starts_at}');
  if _calendar_open and _starts is not null and public.tutorial_text(_payload #> '{meeting,title}', 200) is not null then
    _sections := array_append(_sections, 'calendar');
    insert into public.calendar_events (
      user_id, actor_id, title, kind, starts_at, ends_at, all_day, contact_id, deal_id, is_demo
    )
    values (
      _space, _uid, public.tutorial_text(_payload #> '{meeting,title}', 200), 'meeting',
      _starts, _starts + interval '1 hour', false, _contacts[1], _deal, true
    )
    returning id into _id;
    insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'calendar_events', _id);
  end if;

  -- Their own note in the company
  _content := _payload #> '{note,content}';
  if public.tutorial_text(_payload #> '{note,title}', 200) is not null
     and jsonb_typeof(_content) = 'object' and _content ->> 'type' = 'doc'
  then
    insert into public.notes (user_id, space_id, title, content, content_text, kind, is_demo)
    values (
      _uid,
      _space,
      public.tutorial_text(_payload #> '{note,title}', 200),
      _content,
      left(coalesce(_payload #>> '{note,content_text}', ''), 100000),
      'text',
      true
    )
    returning id into _note;
    insert into public.tutorial_demo_rows (space_id, user_id, kind, row_id) values (_space, _uid, 'notes', _note);
  end if;

  return jsonb_build_object(
    'created', true,
    'seeded_at', _now,
    'sections', to_jsonb(_sections),
    'contacts', to_jsonb(_contacts),
    'deal', _deal,
    'milestone', _milestone,
    'note', _note
  );
end;
$$;
revoke execute on function public.tutorial_seed_worker_demo(jsonb) from public, anon;
grant execute on function public.tutorial_seed_worker_demo(jsonb) to authenticated;

/*
 * The end of a worker's full tutorial: exactly the sample rows it put into
 * the company and what only hangs on them (drafts of invoices for a sample
 * deal or contact, events linked to nothing else). Whatever the worker made
 * themself stays. Returns how many sample rows went.
 */
create or replace function public.tutorial_delete_worker_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid := public.tutorial_worker_space();
  _deals uuid[];
  _contacts uuid[];
  _count integer;
  _total integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('tutorial_demo:' || _space::text || ':' || _uid::text));

  select coalesce(array_agg(r.row_id) filter (where r.kind = 'deals'), '{}'),
         coalesce(array_agg(r.row_id) filter (where r.kind = 'contacts'), '{}')
  into _deals, _contacts
  from public.tutorial_demo_rows r
  where r.space_id = _space and r.user_id = _uid;

  delete from public.invoices i
  where i.user_id = _space and i.status = 'draft'
    and (i.deal_id = any(_deals) or i.contact_id = any(_contacts));

  delete from public.calendar_events e
  where e.user_id = _space and e.source <> 'deal_deadline'
    and (
      (e.is_demo and e.id in (
        select r.row_id from public.tutorial_demo_rows r
        where r.space_id = _space and r.user_id = _uid and r.kind = 'calendar_events'
      ))
      or (e.deal_id = any(_deals) and (e.contact_id is null or e.contact_id = any(_contacts)))
      or (e.contact_id = any(_contacts) and e.deal_id is null)
    );
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.crm_tasks t
  where t.user_id = _space and t.is_demo and t.id in (
    select r.row_id from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and r.kind = 'crm_tasks'
  );
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.deals d where d.user_id = _space and d.is_demo and d.id = any(_deals);
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.contacts c where c.user_id = _space and c.is_demo and c.id = any(_contacts);
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.tasks t
  where t.user_id = _space and t.is_demo and t.parent_task_id is not null and t.id in (
    select r.row_id from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and r.kind = 'tasks'
  );
  delete from public.tasks t
  where t.user_id = _space and t.is_demo and t.id in (
    select r.row_id from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and r.kind = 'tasks'
  );
  delete from public.milestones m
  where m.user_id = _space and m.is_demo and m.id in (
    select r.row_id from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and r.kind = 'milestones'
  );
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.notes n
  where n.user_id = _uid and n.space_id = _space and n.is_demo and n.id in (
    select r.row_id from public.tutorial_demo_rows r
    where r.space_id = _space and r.user_id = _uid and r.kind = 'notes'
  );
  get diagnostics _count = row_count;
  _total := _total + _count;

  delete from public.tutorial_demo_rows r where r.space_id = _space and r.user_id = _uid;

  return jsonb_build_object('deleted', _total);
end;
$$;
revoke execute on function public.tutorial_delete_worker_demo() from public, anon;
grant execute on function public.tutorial_delete_worker_demo() to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('tutorial_access_offer', 'onboarding', false),
  ('worker_invite_edited', 'workers', true)
on conflict (event) do nothing;
