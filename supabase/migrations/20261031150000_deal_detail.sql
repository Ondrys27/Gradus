-- =============================================================================
-- Deal detail (17.2)
--   * deals.assignee_id: the one person who looks after the deal (the owner or
--     an active worker of the space); a new deal gets whoever made it
--   * deals.deadline_date: the delivery date. The database keeps one all-day
--     event in the calendar for it (calendar_events.source = 'deal_deadline',
--     linked through deal_id); changing the date moves it, clearing it removes
--     it. The event can only be opened from the calendar, never changed there.
--   * deals.last_activity_at: the last thing that happened to the deal (an edit,
--     a contact added, a task made or ticked off, a meeting, an e-mail, an
--     invoice). Stamped by the database only; the client can not set it.
--   * deal_contacts: more contacts on one deal, each with a short note ("decides",
--     "invoicing"). Exactly one is primary while the deal has any, and
--     deals.contact_id always equals the primary one (kept for everything that
--     already reads it).
--   * deal_events: what can not be computed afterwards for the deal's history:
--     stage changes (win / loss with the reason), value and Close Date changes.
--     Written by the database only.
--   * note_links may tie a note to a deal (owner's own deals, like tasks).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New columns on deals
-- -----------------------------------------------------------------------------

alter table public.deals
  add column assignee_id uuid default auth.uid() references auth.users (id) on delete set null,
  add column deadline_date date,
  add column last_activity_at timestamptz not null default now();

-- Existing deals: looked after by whoever made them (else the owner); their
-- last activity is the latest of what is known about them. updated_at stays
-- as it was, so nothing looks freshly active.
alter table public.deals disable trigger set_updated_at;
update public.deals d
set
  assignee_id = coalesce(d.created_by, d.user_id),
  last_activity_at = greatest(
    d.created_at,
    d.entered_stage_at,
    coalesce(d.won_at, d.created_at),
    coalesce(d.lost_at, d.created_at),
    coalesce((select max(a.occurred_at) from public.contact_activities a where a.deal_id = d.id), d.created_at),
    coalesce((select max(greatest(t.created_at, coalesce(t.completed_at, t.created_at)))
              from public.crm_tasks t where t.deal_id = d.id), d.created_at),
    coalesce((select max(e.created_at) from public.calendar_events e where e.deal_id = d.id), d.created_at),
    coalesce((select max(greatest(i.created_at, coalesce(i.sent_at, i.created_at),
                                  coalesce(i.cancelled_at, i.created_at)))
              from public.invoices i where i.deal_id = d.id), d.created_at)
  );
alter table public.deals enable trigger set_updated_at;

create index deals_assignee_idx on public.deals (assignee_id);
create index deals_user_last_activity_idx on public.deals (user_id, last_activity_at);

-- -----------------------------------------------------------------------------
-- Contacts of a deal
-- -----------------------------------------------------------------------------

create table public.deal_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null,
  contact_id uuid not null,
  note text check (note is null or char_length(note) <= 200),
  is_primary boolean not null default false,
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, contact_id),
  -- Only a deal and a contact of the same space.
  constraint deal_contacts_deal_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete cascade,
  constraint deal_contacts_contact_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete cascade
);

create unique index deal_contacts_one_primary on public.deal_contacts (deal_id) where is_primary;
create index deal_contacts_contact_idx on public.deal_contacts (contact_id);
create index deal_contacts_user_idx on public.deal_contacts (user_id);

-- The deals' contacts so far become their primary contacts.
insert into public.deal_contacts (user_id, deal_id, contact_id, is_primary, position, created_by, created_at)
select d.user_id, d.id, d.contact_id, true, 0, d.created_by, d.created_at
from public.deals d
where d.contact_id is not null;

create trigger set_updated_at before update on public.deal_contacts
  for each row execute function public.set_updated_at();

create trigger deal_contacts_writable
  before insert or update or delete on public.deal_contacts
  for each row execute function public.enforce_workspace_writable('user_id');

-- Stamps who added the contact, keeps one primary contact per deal and the
-- links fixed. Not SECURITY DEFINER: is_client_request() reads the request's
-- role. The first contact of a deal is primary; marking another one primary
-- unmarks the previous one; the primary mark is never simply taken away
-- (removing the contact or marking another one does that).
create or replace function public.deal_contacts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_client_request() then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    -- A new contact comes last.
    new.position := coalesce(
      (select max(dc.position) + 1 from public.deal_contacts dc where dc.deal_id = new.deal_id),
      0
    );
    if not exists (
      select 1 from public.deal_contacts dc where dc.deal_id = new.deal_id and dc.is_primary
    ) then
      new.is_primary := true;
    end if;
  else
    if (new.deal_id, new.contact_id, new.user_id)
      is distinct from (old.deal_id, old.contact_id, old.user_id)
    then
      raise exception 'deal_contact_fixed' using errcode = 'check_violation';
    end if;
    if public.is_client_request() then
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
    -- Only the database moves the mark away (one level down: marking another one).
    if old.is_primary and not new.is_primary and pg_trigger_depth() = 1 then
      raise exception 'deal_contact_primary_required' using errcode = 'check_violation';
    end if;
  end if;

  new.note := nullif(btrim(new.note), '');

  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
    update public.deal_contacts
    set is_primary = false
    where deal_id = new.deal_id and id <> new.id and is_primary;
  end if;
  return new;
end;
$$;
revoke execute on function public.deal_contacts_guard() from public, anon;

create trigger deal_contacts_guard
  before insert or update on public.deal_contacts
  for each row execute function public.deal_contacts_guard();

-- The primary contact is the deal's contact. SECURITY DEFINER so the deal
-- follows even when the change comes through a contact being deleted.
create or replace function public.deal_contacts_sync_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _next uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if new.is_primary then
      update public.deals
      set contact_id = new.contact_id
      where id = new.deal_id and contact_id is distinct from new.contact_id;
    end if;
    return null;
  end if;

  -- The primary contact left: the next one in order takes over, else none.
  if old.is_primary then
    select dc.id into _next
    from public.deal_contacts dc
    where dc.deal_id = old.deal_id
    order by dc.position, dc.created_at
    limit 1;
    if _next is not null then
      update public.deal_contacts set is_primary = true where id = _next;
    else
      update public.deals
      set contact_id = null
      where id = old.deal_id and contact_id = old.contact_id;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.deal_contacts_sync_deal() from public, anon, authenticated;

create trigger deal_contacts_sync_deal
  after insert or update of is_primary or delete on public.deal_contacts
  for each row execute function public.deal_contacts_sync_deal();

-- deals.contact_id set from elsewhere (a new deal, an older screen, the server)
-- makes that contact the primary one; the previous primary stays on the deal.
create or replace function public.deals_sync_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is null then
    update public.deal_contacts set is_primary = false where deal_id = new.id and is_primary;
  elsif exists (
    select 1 from public.deal_contacts dc where dc.deal_id = new.id and dc.contact_id = new.contact_id
  ) then
    update public.deal_contacts
    set is_primary = true
    where deal_id = new.id and contact_id = new.contact_id and not is_primary;
  else
    insert into public.deal_contacts (user_id, deal_id, contact_id, is_primary, created_by)
    values (new.user_id, new.id, new.contact_id, true, auth.uid());
  end if;
  return null;
end;
$$;
revoke execute on function public.deals_sync_contacts() from public, anon, authenticated;

create trigger deals_sync_contacts
  after insert or update of contact_id on public.deals
  for each row execute function public.deals_sync_contacts();

-- The primary contact cleared (its contact deleted): another contact of the
-- deal takes its place. SECURITY DEFINER: it reads the deal's contacts even
-- when the request may only touch contacts.
create or replace function public.deals_keep_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is null and old.contact_id is not null then
    select dc.contact_id into new.contact_id
    from public.deal_contacts dc
    where dc.deal_id = new.id and dc.contact_id <> old.contact_id
    order by dc.position, dc.created_at
    limit 1;
  end if;
  return new;
end;
$$;
revoke execute on function public.deals_keep_contact() from public, anon, authenticated;

create trigger deals_keep_contact
  before update of contact_id on public.deals
  for each row execute function public.deals_keep_contact();

-- -----------------------------------------------------------------------------
-- Who looks after a deal, and when it last moved
-- -----------------------------------------------------------------------------

-- Runs after deals_stamp_created_by (triggers fire alphabetically), so a new
-- deal goes to whoever really made it. The client never sets last_activity_at;
-- any change of what the deal is moves it to now.
create or replace function public.deals_track_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.assignee_id := coalesce(new.assignee_id, new.created_by, new.user_id);
    if public.is_client_request() then
      new.last_activity_at := now();
    end if;
  else
    if public.is_client_request() then
      new.last_activity_at := old.last_activity_at;
    end if;
    if (new.title, new.description, new.stage_id, new.value, new.currency,
        new.expected_close_date, new.deadline_date, new.assignee_id, new.contact_id,
        new.lost_reason)
      is distinct from
       (old.title, old.description, old.stage_id, old.value, old.currency,
        old.expected_close_date, old.deadline_date, old.assignee_id, old.contact_id,
        old.lost_reason)
    then
      new.last_activity_at := greatest(new.last_activity_at, now());
    end if;
  end if;

  if new.assignee_id is not null
    and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
    and not public.is_workspace_member(new.user_id, new.assignee_id)
  then
    raise exception 'deal_assignee_outside' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.deals_track_activity() from public, anon;

create trigger deals_track_activity
  before insert or update on public.deals
  for each row execute function public.deals_track_activity();

-- Something happened around a deal: its last activity is now. SECURITY
-- DEFINER, so a worker who may book a meeting but not edit deals moves it too.
create or replace function public.deals_touch_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.deals
  set last_activity_at = now()
  where id = new.deal_id and last_activity_at < now();
  return null;
end;
$$;
revoke execute on function public.deals_touch_activity() from public, anon, authenticated;

create trigger deals_touch_activity
  after insert on public.deal_contacts
  for each row execute function public.deals_touch_activity();
create trigger deals_touch_activity
  after insert or update of status on public.crm_tasks
  for each row when (new.deal_id is not null)
  execute function public.deals_touch_activity();
create trigger deals_touch_activity
  after insert on public.contact_activities
  for each row when (new.deal_id is not null)
  execute function public.deals_touch_activity();
create trigger deals_touch_activity
  after insert or update of status, sent_at on public.invoices
  for each row when (new.deal_id is not null)
  execute function public.deals_touch_activity();
-- The deadline's own event is the deal itself; only real appointments count.
create trigger deals_touch_activity
  after insert or update of starts_at, deal_id on public.calendar_events
  for each row when (new.deal_id is not null and new.source <> 'deal_deadline')
  execute function public.deals_touch_activity();

-- -----------------------------------------------------------------------------
-- The delivery date in the calendar
-- -----------------------------------------------------------------------------

alter table public.calendar_events drop constraint calendar_events_source_check;
alter table public.calendar_events add constraint calendar_events_source_check
  check (source in ('manual', 'contact_move', 'deal_deadline'));

create unique index calendar_events_deal_deadline_idx on public.calendar_events (deal_id)
  where source = 'deal_deadline';

-- The client never makes, changes or deletes a deadline event; the deal does.
create or replace function public.calendar_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() then
    if tg_op = 'INSERT' then
      new.source := 'manual';
    elsif old.source = 'deal_deadline' then
      raise exception 'calendar_event_from_deal' using errcode = '42501';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.calendar_events_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() and old.source = 'deal_deadline' then
    raise exception 'calendar_event_from_deal' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke execute on function public.calendar_events_guard_delete() from public, anon;

create trigger calendar_events_guard_delete
  before delete on public.calendar_events
  for each row execute function public.calendar_events_guard_delete();

-- One all-day event named after the deal on its delivery date, on the day in
-- the owner's time zone (the space's calendar). SECURITY DEFINER: a worker
-- who edits the pipeline keeps the event right without calendar rights.
create or replace function public.deals_sync_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _zone text;
  _start timestamptz;
begin
  if tg_op = 'UPDATE'
    and (new.deadline_date, new.title) is not distinct from (old.deadline_date, old.title)
  then
    return null;
  end if;

  if new.deadline_date is null then
    delete from public.calendar_events where deal_id = new.id and source = 'deal_deadline';
    return null;
  end if;

  select s.timezone into _zone from public.user_settings s where s.user_id = new.user_id;
  _start := new.deadline_date::timestamp at time zone coalesce(_zone, 'Europe/Prague');

  update public.calendar_events
  set title = new.title, starts_at = _start, ends_at = null, all_day = true, kind = 'deadline'
  where deal_id = new.id and source = 'deal_deadline';
  if not found then
    insert into public.calendar_events
      (user_id, actor_id, title, kind, starts_at, ends_at, all_day, deal_id, source)
    values
      (new.user_id, coalesce(auth.uid(), new.user_id), new.title, 'deadline', _start, null, true,
       new.id, 'deal_deadline');
  end if;
  return null;
end;
$$;
revoke execute on function public.deals_sync_deadline() from public, anon, authenticated;

create trigger deals_sync_deadline
  after insert or update of deadline_date, title on public.deals
  for each row execute function public.deals_sync_deadline();

-- A deleted deal takes its deadline event along (the link alone would only be cleared).
create or replace function public.deals_drop_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_events where deal_id = old.id and source = 'deal_deadline';
  return old;
end;
$$;
revoke execute on function public.deals_drop_deadline() from public, anon, authenticated;

create trigger deals_drop_deadline
  before delete on public.deals
  for each row execute function public.deals_drop_deadline();

-- -----------------------------------------------------------------------------
-- What happened to a deal (for its history)
-- -----------------------------------------------------------------------------

create table public.deal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('stage', 'value', 'close_date')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint deal_events_deal_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete cascade
);

create index deal_events_deal_idx on public.deal_events (deal_id, occurred_at desc);
create index deal_events_user_idx on public.deal_events (user_id, occurred_at desc);

alter table public.deal_events enable row level security;

create policy deal_events_select_workspace on public.deal_events
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'view'))
    )
  );

revoke all on public.deal_events from anon;
revoke insert, update, delete on public.deal_events from authenticated;

-- Stage names are kept as they were then: a stage can be renamed or removed.
create or replace function public.deals_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _actor uuid := auth.uid();
  _from public.pipeline_stages;
  _to public.pipeline_stages;
begin
  if new.stage_id is distinct from old.stage_id then
    select * into _from from public.pipeline_stages where id = old.stage_id;
    select * into _to from public.pipeline_stages where id = new.stage_id;
    insert into public.deal_events (user_id, deal_id, actor_id, kind, payload)
    values (new.user_id, new.id, _actor, 'stage', jsonb_build_object(
      'from_stage_id', old.stage_id,
      'to_stage_id', new.stage_id,
      'from_name', _from.name,
      'to_name', _to.name,
      'won', coalesce(_to.is_won, false),
      'lost', coalesce(_to.is_lost, false),
      'reason', case when coalesce(_to.is_lost, false) then new.lost_reason end
    ));
  end if;
  if (new.value, new.currency) is distinct from (old.value, old.currency) then
    insert into public.deal_events (user_id, deal_id, actor_id, kind, payload)
    values (new.user_id, new.id, _actor, 'value', jsonb_build_object(
      'from', old.value, 'to', new.value,
      'from_currency', old.currency, 'to_currency', new.currency
    ));
  end if;
  if new.expected_close_date is distinct from old.expected_close_date then
    insert into public.deal_events (user_id, deal_id, actor_id, kind, payload)
    values (new.user_id, new.id, _actor, 'close_date', jsonb_build_object(
      'from', old.expected_close_date, 'to', new.expected_close_date
    ));
  end if;
  return null;
end;
$$;
revoke execute on function public.deals_log_events() from public, anon, authenticated;

create trigger deals_log_events
  after update of stage_id, value, currency, expected_close_date on public.deals
  for each row execute function public.deals_log_events();

-- -----------------------------------------------------------------------------
-- Row level security for deal_contacts (like deals: the pipeline section)
-- -----------------------------------------------------------------------------

alter table public.deal_contacts enable row level security;

create policy deal_contacts_select_workspace on public.deal_contacts
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'view'))
    )
  );

create policy deal_contacts_insert_workspace on public.deal_contacts
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
    )
  );

create policy deal_contacts_update_workspace on public.deal_contacts
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
    )
  )
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
    )
  );

create policy deal_contacts_delete_workspace on public.deal_contacts
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_section_access(public.current_workspace_id(), 'pipeline', 'edit'))
    )
  );

-- The client names the deal, the contact, the note and the primary mark; the
-- rest is stamped.
revoke all on public.deal_contacts from anon;
revoke insert, update on public.deal_contacts from authenticated;
grant insert (user_id, deal_id, contact_id, note, is_primary) on public.deal_contacts to authenticated;
grant update (note, is_primary) on public.deal_contacts to authenticated;

-- -----------------------------------------------------------------------------
-- Notes tied to a deal (the owner's own deals, like tasks and milestones)
-- -----------------------------------------------------------------------------

alter table public.note_links
  add column deal_id uuid references public.deals (id) on delete cascade;

alter table public.note_links drop constraint note_links_check;
alter table public.note_links add constraint note_links_one_target
  check (num_nonnulls(task_id, milestone_id, deal_id) = 1);

create unique index note_links_deal_unique on public.note_links (note_id, deal_id)
  where deal_id is not null;
create index note_links_deal_idx on public.note_links (deal_id) where deal_id is not null;

drop policy note_links_insert_own on public.note_links;
create policy note_links_insert_own on public.note_links for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    )
    and (task_id is null or exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    ))
    and (milestone_id is null or exists (
      select 1 from public.milestones m
      where m.id = milestone_id and m.user_id = (select auth.uid())
    ))
    and (deal_id is null or exists (
      select 1 from public.deals d
      where d.id = deal_id and d.user_id = (select auth.uid())
    ))
  );

grant insert (note_id, task_id, milestone_id, deal_id) on public.note_links to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('deal_contact_added', 'pipeline', true),
  ('deal_contact_removed', 'pipeline', true),
  ('deal_contact_updated', 'pipeline', true)
on conflict (event) do nothing;
