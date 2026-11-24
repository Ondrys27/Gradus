-- =============================================================================
-- Activity in the company and meeting notes (step 28.7)
--   * activity_log: "who did what" in a space, written only by the database
--     from the same changes that make a deal's history (triggers on deals,
--     contacts, moves, contact activities, sales and milestone tasks,
--     milestones, calendar events, invoices and transactions). One row per
--     meaningful step, with the actor (auth.uid()), how it was done (app,
--     Grady or an MCP client: the x-gradus-via header the server sends for
--     its own clients; it only labels the actor's own step) and a short
--     summary (a title, a stage, an amount). Nothing for writes without a
--     signed-in user (crons, webhooks, the admin client) and nothing for the
--     tutorial's samples. No client reads or writes the table: the timeline
--     and the daily sums come from activity_feed() / activity_daily(), which
--     show the people the caller may see (the owner everybody, a worker their
--     branch of the company, with "company: view all" everybody) and blank
--     the titles and amounts of sections the caller has no right to.
--     Kept 180 days (purge_activity_log(), the daily retention cron).
--   * deal_attachments: texts kept with a deal; for now the transcript of a
--     meeting, saved only when the user ticks it in "Paste meeting notes".
--     Read by whoever sees the deal, written by whoever may update it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- activity_log
-- -----------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  via text not null default 'app' check (via in ('app', 'grady', 'mcp')),
  verb text not null check (verb ~ '^[a-z][a-z_]{1,39}$'),
  object_kind text not null check (object_kind in (
    'deal', 'contact', 'crm_task', 'task', 'milestone', 'event', 'invoice', 'transaction')),
  object_id uuid,
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 2048),
  created_at timestamptz not null default now()
);

create index activity_log_space_idx on public.activity_log (space_id, created_at desc);
create index activity_log_actor_idx on public.activity_log (space_id, actor_id, created_at desc);
create index activity_log_age_idx on public.activity_log (created_at);

alter table public.activity_log enable row level security;
-- No policies: read through activity_feed() / activity_daily(), written by triggers only.
revoke all on public.activity_log from anon, authenticated;
grant select, insert, delete on public.activity_log to service_role;

/** How the current request was made: the label the server's own clients send. */
create or replace function public.activity_via()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  _raw text := nullif(current_setting('request.headers', true), '');
  _via text;
begin
  if _raw is null then
    return 'app';
  end if;
  begin
    _via := _raw::json ->> 'x-gradus-via';
  exception when others then
    return 'app';
  end;
  return case when _via in ('grady', 'mcp') then _via else 'app' end;
end;
$$;
revoke execute on function public.activity_via() from public, anon, authenticated;

/** One step of the signed-in user into the log; nothing without a user. */
create or replace function public.activity_add(
  _space uuid,
  _verb text,
  _kind text,
  _object uuid,
  _summary jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null or _space is null then
    return;
  end if;
  insert into public.activity_log (space_id, actor_id, via, verb, object_kind, object_id, summary)
  values (
    _space, _uid, public.activity_via(), _verb, _kind, _object,
    jsonb_strip_nulls(coalesce(_summary, '{}'::jsonb))
  );
end;
$$;
revoke execute on function public.activity_add(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

/** A title cut for the log (the summary stays small). */
create or replace function public.activity_title(_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(_text, '')), 120), '');
$$;

create or replace function public.activity_contact_name(_contact public.contacts)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.activity_title(coalesce(
    nullif(btrim(_contact.company_name), ''),
    nullif(btrim(concat_ws(' ', _contact.first_name, _contact.last_name)), '')
  ));
$$;

-- Deals: made, moved, won, lost, value changed, deleted.
create or replace function public.activity_deals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _from public.pipeline_stages;
  _to public.pipeline_stages;
begin
  if tg_op = 'DELETE' then
    if old.is_demo or pg_trigger_depth() > 1 then
      return old;
    end if;
    perform public.activity_add(old.user_id, 'deleted', 'deal', old.id,
      jsonb_build_object('title', public.activity_title(old.title)));
    return old;
  end if;
  if new.is_demo then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into _to from public.pipeline_stages where id = new.stage_id;
    perform public.activity_add(new.user_id,
      case when _to.is_won then 'won' else 'created' end, 'deal', new.id,
      jsonb_build_object('title', public.activity_title(new.title), 'stage', _to.name,
        'amount', new.value, 'currency', new.currency));
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    select * into _from from public.pipeline_stages where id = old.stage_id;
    select * into _to from public.pipeline_stages where id = new.stage_id;
    perform public.activity_add(new.user_id,
      case when _to.is_won then 'won' when _to.is_lost then 'lost' else 'stage_changed' end,
      'deal', new.id,
      jsonb_build_object('title', public.activity_title(new.title), 'from', _from.name,
        'stage', _to.name, 'amount', new.value, 'currency', new.currency));
  elsif new.value is distinct from old.value or new.currency is distinct from old.currency then
    perform public.activity_add(new.user_id, 'amount_changed', 'deal', new.id,
      jsonb_build_object('title', public.activity_title(new.title), 'amount', new.value,
        'currency', new.currency));
  end if;
  return new;
end;
$$;
create trigger deals_activity
  after insert or update of stage_id, value, currency or delete on public.deals
  for each row execute function public.activity_deals();

-- Contacts: added by hand (generated ones are many at once and not a person's step), deleted.
create or replace function public.activity_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_demo or pg_trigger_depth() > 1 then
      return old;
    end if;
    perform public.activity_add(old.user_id, 'deleted', 'contact', old.id,
      jsonb_build_object('title', public.activity_contact_name(old)));
    return old;
  end if;
  if new.is_demo or new.source::text = 'generated' then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'created', 'contact', new.id,
    jsonb_build_object('title', public.activity_contact_name(new)));
  return new;
end;
$$;
create trigger contacts_activity
  after insert or delete on public.contacts
  for each row execute function public.activity_contacts();

-- A contact moved to another table (Cold Calling, Contacts).
create or replace function public.activity_contact_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _contact public.contacts;
  _table text;
begin
  if new.from_table_id is null or new.to_table_id is null then
    return new;
  end if;
  select * into _contact from public.contacts where id = new.contact_id;
  if _contact.id is null or _contact.is_demo then
    return new;
  end if;
  select name into _table from public.contact_tables where id = new.to_table_id;
  perform public.activity_add(new.user_id, 'moved', 'contact', new.contact_id,
    jsonb_build_object('title', public.activity_contact_name(_contact),
      'table', public.activity_title(_table)));
  return new;
end;
$$;
create trigger contact_table_moves_activity
  after insert on public.contact_table_moves
  for each row execute function public.activity_contact_moves();

-- A call, e-mail, meeting, SMS or note with a contact.
create or replace function public.activity_contact_activities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _contact public.contacts;
begin
  if new.type::text not in ('call', 'email', 'meeting', 'sms', 'note') then
    return new;
  end if;
  select * into _contact from public.contacts where id = new.contact_id;
  if _contact.id is null or _contact.is_demo then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'logged_' || new.type::text, 'contact', new.contact_id,
    jsonb_build_object('title', public.activity_contact_name(_contact)));
  return new;
end;
$$;
create trigger contact_activities_activity
  after insert on public.contact_activities
  for each row execute function public.activity_contact_activities();

-- Sales tasks: made, done, reopened, deleted.
create or replace function public.activity_crm_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_demo or pg_trigger_depth() > 1 then
      return old;
    end if;
    perform public.activity_add(old.user_id, 'deleted', 'crm_task', old.id,
      jsonb_build_object('title', public.activity_title(old.title)));
    return old;
  end if;
  if new.is_demo then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.activity_add(new.user_id, 'created', 'crm_task', new.id,
      jsonb_build_object('title', public.activity_title(new.title)));
  elsif new.status is distinct from old.status then
    perform public.activity_add(new.user_id,
      case when new.status::text = 'done' then 'completed' else 'reopened' end,
      'crm_task', new.id, jsonb_build_object('title', public.activity_title(new.title)));
  end if;
  return new;
end;
$$;
create trigger crm_tasks_activity
  after insert or update of status or delete on public.crm_tasks
  for each row execute function public.activity_crm_tasks();

-- Milestone tasks: done.
create or replace function public.activity_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo or new.status is not distinct from old.status or new.status::text <> 'done' then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'completed', 'task', new.id,
    jsonb_build_object('title', public.activity_title(new.title)));
  return new;
end;
$$;
create trigger tasks_activity
  after update of status on public.tasks
  for each row execute function public.activity_tasks();

-- Milestones: finished.
create or replace function public.activity_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo or new.status is not distinct from old.status
    or new.status::text <> 'completed' then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'completed', 'milestone', new.id,
    jsonb_build_object('title', public.activity_title(new.title)));
  return new;
end;
$$;
create trigger milestones_activity
  after update of status on public.milestones
  for each row execute function public.activity_milestones();

-- Calendar: a meeting or another event planned by hand (a deal's delivery date is the deal's own).
create or replace function public.activity_calendar_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_demo or new.source = 'deal_deadline' then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'scheduled', 'event', new.id,
    jsonb_build_object('title', public.activity_title(new.title), 'kind', new.kind::text,
      'at', new.starts_at));
  return new;
end;
$$;
create trigger calendar_events_activity
  after insert on public.calendar_events
  for each row execute function public.activity_calendar_events();

-- Invoices: issued, paid, cancelled.
create or replace function public.activity_invoices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _verb text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  _verb := case
    when old.status::text = 'draft' and new.status::text = 'open' then 'issued'
    when new.status::text = 'paid' then 'paid'
    when new.status::text = 'cancelled' then 'cancelled'
    else null
  end;
  if _verb is null or new.kind = 'credit_note' then
    return new;
  end if;
  perform public.activity_add(new.user_id, _verb, 'invoice', new.id,
    jsonb_build_object('title', public.activity_title(new.number),
      'customer', public.activity_title(new.customer_name),
      'amount', new.total, 'currency', new.currency));
  return new;
end;
$$;
create trigger invoices_activity
  after update of status on public.invoices
  for each row execute function public.activity_invoices();

-- Transactions entered by a person (recurring ones and bookings of the database have no user).
create or replace function public.activity_transactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source::text <> 'manual' then
    return new;
  end if;
  perform public.activity_add(new.user_id, 'created', 'transaction', new.id,
    jsonb_build_object('title', public.activity_title(coalesce(new.description, new.category)),
      'type', new.type::text, 'amount', new.amount, 'currency', new.currency));
  return new;
end;
$$;
create trigger transactions_activity
  after insert on public.transactions
  for each row execute function public.activity_transactions();

-- -----------------------------------------------------------------------------
-- Reading: who the caller may see, and what of it
-- -----------------------------------------------------------------------------

/**
 * The accounts whose steps the caller sees in a space: the owner everybody;
 * a worker with "company: view" their branch (themselves and everyone under
 * them), with "view all" the whole company with the owner. Null = everybody.
 */
create or replace function public.activity_visible_actors(_space uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _actors uuid[];
begin
  if _uid is null or _space is null then
    return array[]::uuid[];
  end if;
  if _space = _uid then
    return null;
  end if;
  if not public.is_space_member(_space) then
    return array[]::uuid[];
  end if;
  select coalesce(array_agg(w.user_id) filter (where w.user_id is not null), array[]::uuid[])
    into _actors
  from public.workers w
  where w.id in (select v.id from public.company_visible_worker_ids_in(_space) v (id));
  if public.has_permission(_space, 'company', 'view_all') then
    _actors := _actors || _space;
  end if;
  -- Always one's own steps.
  if not (_uid = any (_actors)) then
    _actors := _actors || _uid;
  end if;
  return _actors;
end;
$$;
revoke execute on function public.activity_visible_actors(uuid) from public, anon;
grant execute on function public.activity_visible_actors(uuid) to authenticated;

/** A summary as the caller may read it: no title of a section they do not see, no amount they may not. */
create or replace function public.activity_masked(_space uuid, _kind text, _summary jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _sees boolean;
  _amounts boolean;
  _out jsonb := _summary;
begin
  if _space = auth.uid() then
    return _summary;
  end if;
  _sees := case _kind
    when 'deal' then public.has_permission(_space, 'pipeline', 'view')
    when 'contact' then public.has_permission(_space, 'contacts', 'view')
      or public.has_permission(_space, 'cold_calling', 'view')
    when 'crm_task' then public.has_permission(_space, 'tasks', 'view')
    when 'task' then public.has_permission(_space, 'milestones', 'view')
    when 'milestone' then public.has_permission(_space, 'milestones', 'view')
    when 'event' then public.has_permission(_space, 'calendar', 'view')
    when 'invoice' then public.has_permission(_space, 'invoices', 'view')
    when 'transaction' then public.has_permission(_space, 'finance', 'view')
    else false
  end;
  _amounts := case _kind
    when 'deal' then public.has_permission(_space, 'pipeline', 'see_amounts')
    when 'invoice' then public.has_permission(_space, 'invoices', 'view')
    when 'transaction' then public.has_permission(_space, 'finance', 'view')
    else true
  end;
  if not _sees then
    _out := _out - 'title' - 'customer' - 'stage' - 'from' - 'table';
  end if;
  if not (_sees and _amounts) then
    _out := _out - 'amount' - 'currency';
  end if;
  return _out;
end;
$$;
revoke execute on function public.activity_masked(uuid, text, jsonb) from public, anon, authenticated;

/**
 * The timeline: newest first, `_limit` rows before `_before` (paging), within
 * [_from, _until), optionally only some people (`_actors`) and kinds.
 */
create or replace function public.activity_feed(
  _space uuid,
  _from timestamptz,
  _until timestamptz,
  _actors uuid[] default null,
  _kinds text[] default null,
  _before timestamptz default null,
  _limit integer default 50
)
returns table (
  id uuid,
  actor_id uuid,
  via text,
  verb text,
  object_kind text,
  object_id uuid,
  summary jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _visible uuid[] := public.activity_visible_actors(_space);
begin
  if auth.uid() is null or (_visible is not null and cardinality(_visible) = 0) then
    return;
  end if;
  return query
    select a.id, a.actor_id, a.via, a.verb, a.object_kind, a.object_id,
      public.activity_masked(_space, a.object_kind, a.summary), a.created_at
    from public.activity_log a
    where a.space_id = _space
      and a.created_at >= _from
      and a.created_at < _until
      and (_before is null or a.created_at < _before)
      and (_visible is null or a.actor_id = any (_visible))
      and (_actors is null or a.actor_id = any (_actors))
      and (_kinds is null or a.object_kind = any (_kinds))
    order by a.created_at desc, a.id desc
    limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$$;
revoke execute on function public.activity_feed(uuid, timestamptz, timestamptz, uuid[], text[], timestamptz, integer) from public, anon;
grant execute on function public.activity_feed(uuid, timestamptz, timestamptz, uuid[], text[], timestamptz, integer) to authenticated;

/** Per person and day (in `_tz`): tasks done, deals made or won, calls, meetings. */
create or replace function public.activity_daily(
  _space uuid,
  _from timestamptz,
  _until timestamptz,
  _tz text,
  _actors uuid[] default null
)
returns table (
  actor_id uuid,
  day date,
  tasks integer,
  deals integer,
  calls integer,
  meetings integer,
  total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _visible uuid[] := public.activity_visible_actors(_space);
  _zone text := coalesce(nullif(_tz, ''), 'UTC');
begin
  if auth.uid() is null or (_visible is not null and cardinality(_visible) = 0) then
    return;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = _zone) then
    _zone := 'UTC';
  end if;
  return query
    select a.actor_id,
      (a.created_at at time zone _zone)::date as day,
      count(*) filter (where a.verb = 'completed' and a.object_kind in ('crm_task', 'task'))::integer,
      count(*) filter (where a.object_kind = 'deal' and a.verb in ('created', 'won'))::integer,
      count(*) filter (where a.verb = 'logged_call')::integer,
      count(*) filter (where a.verb = 'logged_meeting'
        or (a.object_kind = 'event' and a.summary ->> 'kind' = 'meeting'))::integer,
      count(*)::integer
    from public.activity_log a
    where a.space_id = _space
      and a.actor_id is not null
      and a.created_at >= _from
      and a.created_at < _until
      and (_visible is null or a.actor_id = any (_visible))
      and (_actors is null or a.actor_id = any (_actors))
    group by a.actor_id, 2
    order by 2 desc, a.actor_id;
end;
$$;
revoke execute on function public.activity_daily(uuid, timestamptz, timestamptz, text, uuid[]) from public, anon;
grant execute on function public.activity_daily(uuid, timestamptz, timestamptz, text, uuid[]) to authenticated;

/** 180 days of activity are kept; the daily retention cron calls this. */
create or replace function public.purge_activity_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _removed integer;
begin
  delete from public.activity_log where created_at < now() - interval '180 days';
  get diagnostics _removed = row_count;
  return _removed;
end;
$$;
revoke execute on function public.purge_activity_log() from public, anon, authenticated;
grant execute on function public.purge_activity_log() to service_role;

-- -----------------------------------------------------------------------------
-- deal_attachments
-- -----------------------------------------------------------------------------

create table public.deal_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null,
  kind text not null default 'meeting_transcript' check (kind in ('meeting_transcript')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  content text not null check (char_length(content) between 1 and 400000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_attachments_deal_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete cascade
);

create index deal_attachments_deal_idx on public.deal_attachments (deal_id, created_at desc);
create index deal_attachments_user_idx on public.deal_attachments (user_id);

alter table public.deal_attachments enable row level security;

create policy deal_attachments_select on public.deal_attachments
  for select to authenticated
  using (
    user_id = any ((select public.section_spaces('pipeline', 'view'))::uuid[])
    and exists (select 1 from public.deals d where d.id = deal_attachments.deal_id)
  );
create policy deal_attachments_insert on public.deal_attachments
  for insert to authenticated
  with check (
    user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.deals d
      where d.id = deal_attachments.deal_id and d.user_id = deal_attachments.user_id
    )
  );
create policy deal_attachments_delete on public.deal_attachments
  for delete to authenticated
  using (
    user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
    and exists (select 1 from public.deals d where d.id = deal_attachments.deal_id)
  );

revoke update on public.deal_attachments from authenticated;
grant select, insert, delete on public.deal_attachments to authenticated;

create trigger deal_attachments_writable
  before insert or update or delete on public.deal_attachments
  for each row execute function public.enforce_workspace_writable('user_id');

-- -----------------------------------------------------------------------------
-- Analytics: counts and kinds only, never text, names or amounts
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('meeting_notes_opened', 'pipeline', false),
  ('meeting_notes_analyzed', 'pipeline', true),
  ('meeting_notes_applied', 'pipeline', true),
  ('company_activity_viewed', 'workers', false)
on conflict (event) do nothing;
