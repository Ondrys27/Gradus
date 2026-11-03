-- =============================================================================
-- Worker dashboard (19.3)
--   * workers: first_name / last_name next to name (kept in sync both ways),
--     description, a photo in the worker-avatars bucket
--   * fine rights: worker_permission_grants (worker, section, action, allowed)
--     next to worker_permissions. The catalog (permission_catalog(), mirrored
--     by src/features/workers/permissions-catalog.ts) names every action;
--     has_permission(owner, section, action) decides. worker_permissions stays
--     as the coarse view / edit the older policies read: it is derived from
--     the grants (view = the section's "view", edit = view and any write
--     action) and a direct write of it (older code, scripts) is mirrored back
--     into the grants (view = the view-type actions, edit = those and the
--     write actions).
--   * restrictive policies add the fine rights on top of the section policies:
--     contacts (create / update / delete), deals (all or own, create, update,
--     stage, amount, delete), sales tasks (all or own, create, update, assign
--     to others, delete), calendar (all or own, create, update), finance
--     (view / write), invoices (view / issue), cold calling statistics of others
--   * company: company.view / view_all / update decide what a worker sees and
--     changes in Company; company_worker() reads one person, company_update_
--     worker() and company_set_group_member() change them, company_remove_
--     worker() ends a worker's access and hands their deals and tasks over
--   * worker_documents + the private worker-documents bucket: the owner and
--     whoever may update the person in Company manage them, the worker reads
--     their own, nobody else (not even their manager)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workers: first and last name, description, photo
-- -----------------------------------------------------------------------------

alter table public.workers
  add column first_name text,
  add column last_name text,
  add column description text,
  add column avatar_url text,
  -- 40 + space + 39 fits the 80 characters of name.
  add constraint workers_first_name_length
    check (first_name is null or char_length(first_name) between 1 and 40),
  add constraint workers_last_name_length
    check (last_name is null or char_length(last_name) between 1 and 39),
  add constraint workers_description_length
    check (description is null or char_length(description) between 1 and 4000),
  add constraint workers_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 600);

-- Today's names split at the first space, before the sync trigger exists so
-- no name is rewritten.
update public.workers w
set
  first_name = nullif(left(split_part(btrim(w.name), ' ', 1), 40), ''),
  last_name = nullif(
    left(btrim(substr(btrim(w.name), char_length(split_part(btrim(w.name), ' ', 1)) + 1)), 39),
    ''
  )
where w.first_name is null and w.last_name is null;

-- name follows first and last name; a name written as one (the invite form,
-- older code) is split into them. A photo is only ever the worker's own file
-- in the worker-avatars bucket.
create or replace function public.workers_profile_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _name text;
  _first text;
  _split boolean;
begin
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  new.description := nullif(btrim(new.description), '');

  if tg_op = 'INSERT' then
    _split := new.first_name is null and new.last_name is null;
  elsif (new.first_name, new.last_name) is distinct from (old.first_name, old.last_name) then
    _split := false;
  elsif new.name is distinct from old.name then
    _split := true;
  else
    _split := null;
  end if;

  if _split then
    _name := btrim(new.name);
    new.name := _name;
    _first := split_part(_name, ' ', 1);
    new.first_name := nullif(left(_first, 40), '');
    new.last_name := nullif(left(btrim(substr(_name, char_length(_first) + 1)), 39), '');
  elsif _split is not null then
    new.name := concat_ws(' ', new.first_name, new.last_name);
  end if;

  if new.avatar_url is not null
     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
     and new.avatar_url !~ (
       '^https?://[^/?#\s]+/storage/v1/object/public/worker-avatars/'
       || new.owner_id::text || '/' || new.id::text || '/[A-Za-z0-9._-]{1,80}(\?v=[0-9]{1,20})?$'
     )
  then
    raise exception 'worker_avatar_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.workers_profile_sync() from public, anon, authenticated;

create trigger workers_profile_sync
  before insert or update on public.workers
  for each row execute function public.workers_profile_sync();

-- -----------------------------------------------------------------------------
-- The catalog of rights (mirrors src/features/workers/permissions-catalog.ts)
--   kind view:  implied by the older "sees the section"
--   kind read:  more to see, never implied by the older rights, granted on
--               its own (export, others' statistics, everyone in Company)
--   kind write: changes something; any of them makes the older "edit"
-- Dashboard, notes and settings are no rows here: the worker's own dashboard
-- and account are always theirs, the owner's notes and settings never are.
-- -----------------------------------------------------------------------------

create or replace function public.permission_catalog()
returns table (section text, action text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('milestones', 'view', 'view'),
    ('milestones', 'update', 'write'),
    ('contacts', 'view', 'view'),
    ('contacts', 'create', 'write'),
    ('contacts', 'update', 'write'),
    ('contacts', 'delete', 'write'),
    ('contacts', 'export', 'read'),
    ('contacts', 'generate', 'write'),
    ('pipeline', 'view', 'view'),
    ('pipeline', 'view_all', 'view'),
    ('pipeline', 'see_amounts', 'view'),
    ('pipeline', 'create', 'write'),
    ('pipeline', 'update', 'write'),
    ('pipeline', 'change_stage', 'write'),
    ('pipeline', 'change_amount', 'write'),
    ('pipeline', 'delete', 'write'),
    ('tasks', 'view', 'view'),
    ('tasks', 'view_all', 'view'),
    ('tasks', 'create', 'write'),
    ('tasks', 'update', 'write'),
    ('tasks', 'assign_others', 'write'),
    ('tasks', 'delete', 'write'),
    ('cold_calling', 'view', 'view'),
    ('cold_calling', 'call', 'write'),
    ('cold_calling', 'view_others_stats', 'read'),
    ('calendar', 'view', 'view'),
    ('calendar', 'view_all', 'view'),
    ('calendar', 'create', 'write'),
    ('calendar', 'update', 'write'),
    ('finance', 'view', 'view'),
    ('finance', 'summaries', 'view'),
    ('finance', 'write', 'write'),
    ('invoices', 'view', 'view'),
    ('invoices', 'issue', 'write'),
    ('company', 'view', 'view'),
    ('company', 'view_all', 'read'),
    ('company', 'update', 'write')
  ) as c (section, action, kind);
$$;

create or replace function public.permission_action_valid(_section text, _action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from public.permission_catalog() c where c.section = _section and c.action = _action
  );
$$;

-- What holds without a row: every worker has Tasks (their own) and their own
-- branch in Company until the owner switches it off.
create or replace function public.permission_default(_section text, _action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _action = 'view' and _section in ('tasks', 'company');
$$;

grant execute on function public.permission_catalog(), public.permission_action_valid(text, text),
  public.permission_default(text, text) to authenticated, service_role;

create table public.worker_permission_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  worker_id uuid not null,
  section text not null,
  action text not null,
  allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, section, action),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade,
  constraint worker_permission_grants_known check (public.permission_action_valid(section, action))
);
create index worker_permission_grants_owner_idx on public.worker_permission_grants (owner_id);

create trigger set_updated_at before update on public.worker_permission_grants
  for each row execute function public.set_updated_at();

-- The owner decides, the worker reads their own (their app shapes itself by it).
alter table public.worker_permission_grants enable row level security;
create policy "worker_permission_grants_owner_all" on public.worker_permission_grants
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_permission_grants_worker_select" on public.worker_permission_grants
  for select to authenticated
  using (worker_id in (select public.my_worker_ids()));
revoke all on public.worker_permission_grants from anon;

-- One right of one worker: the row, else the default. Internal.
create or replace function public.worker_grant(_worker_id uuid, _section text, _action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.permission_action_valid(_section, _action) and coalesce(
    (
      select g.allowed from public.worker_permission_grants g
      where g.worker_id = _worker_id and g.section = _section and g.action = _action
    ),
    public.permission_default(_section, _action)
  );
$$;
revoke execute on function public.worker_grant(uuid, text, text) from public, anon, authenticated;

-- Whether the signed-in account may do this in the space of _owner: the
-- owner always; an active worker of that owner when the action and the
-- section's "view" are granted. Mirrors canDo() in src/features/account/workspace.ts.
create or replace function public.has_permission(_owner uuid, _section text, _action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and _owner is not null
    and public.permission_action_valid(_section, _action)
    and (
      _owner = auth.uid()
      or exists (
        select 1 from public.workers w
        where w.owner_id = _owner
          and w.user_id = auth.uid()
          and w.status = 'active'
          and public.worker_grant(w.id, _section, 'view')
          and public.worker_grant(w.id, _section, _action)
      )
    ),
    false
  );
$$;
revoke execute on function public.has_permission(uuid, text, text) from public, anon;
grant execute on function public.has_permission(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Today's rights become grants: edit = the view-type and write actions of
-- the section, view = its view-type actions; what did not exist before
-- (export, others' statistics) waits for the owner to grant it. Tasks follow pipeline, contacts and cold calling,
-- invoices follow finance; everybody keeps their branch in Company.
-- -----------------------------------------------------------------------------

insert into public.worker_permission_grants (owner_id, worker_id, section, action, allowed)
select
  w.owner_id,
  w.id,
  c.section,
  c.action,
  case
    when c.section = 'company' then c.action = 'view'
    when c.section = 'tasks' then
      case c.action
        when 'view' then true
        when 'view_all' then coalesce(t.viewing, false)
        else coalesce(t.editing, false)
      end
    else (c.kind = 'write' and coalesce(p.can_edit, false))
      or (c.kind = 'view' and coalesce(p.can_view or p.can_edit, false))
  end
from public.workers w
cross join public.permission_catalog() c
left join public.worker_permissions p
  on p.worker_id = w.id
  and p.section::text = case c.section when 'invoices' then 'finance' else c.section end
left join lateral (
  select bool_or(x.can_view or x.can_edit) as viewing, bool_or(x.can_edit) as editing
  from public.worker_permissions x
  where x.worker_id = w.id and x.section::text in ('pipeline', 'contacts', 'cold_calling')
) t on true
on conflict (worker_id, section, action) do nothing;

-- -----------------------------------------------------------------------------
-- Keeping the two in step
-- -----------------------------------------------------------------------------

-- worker_permissions from the grants: the six sections the older policies know.
create or replace function public.worker_permissions_derive(_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
begin
  select w.owner_id into _owner from public.workers w where w.id = _worker_id;
  if _owner is null then
    return;
  end if;
  insert into public.worker_permissions (owner_id, worker_id, section, can_view, can_edit)
  with per_section as (
    select
      c.section,
      bool_or(public.worker_grant(_worker_id, c.section, c.action)) filter (where c.action = 'view')
        as viewing,
      coalesce(
        bool_or(public.worker_grant(_worker_id, c.section, c.action)) filter (where c.kind = 'write'),
        false
      ) as acting
    from public.permission_catalog() c
    group by c.section
  ),
  legacy (section, sources) as (
    values
      ('milestones', array['milestones']),
      ('contacts', array['contacts']),
      ('pipeline', array['pipeline']),
      ('cold_calling', array['cold_calling']),
      ('calendar', array['calendar']),
      ('finance', array['finance', 'invoices'])
  )
  select
    _owner,
    _worker_id,
    l.section::public.app_section,
    coalesce(bool_or(p.viewing), false),
    coalesce(bool_or(p.viewing and p.acting), false)
  from legacy l
  join per_section p on p.section = any (l.sources)
  group by l.section
  on conflict (worker_id, section) do update
    set can_view = excluded.can_view, can_edit = excluded.can_edit, updated_at = now();
end;
$$;
revoke execute on function public.worker_permissions_derive(uuid) from public, anon, authenticated;

-- Tasks after an older write of pipeline / contacts / cold calling.
create or replace function public.worker_tasks_grants_from_sections(_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
  _viewing boolean;
  _editing boolean;
begin
  select w.owner_id into _owner from public.workers w where w.id = _worker_id;
  if _owner is null then
    return;
  end if;
  select coalesce(bool_or(p.can_view or p.can_edit), false), coalesce(bool_or(p.can_edit), false)
  into _viewing, _editing
  from public.worker_permissions p
  where p.worker_id = _worker_id and p.section::text in ('pipeline', 'contacts', 'cold_calling');

  insert into public.worker_permission_grants (owner_id, worker_id, section, action, allowed)
  select _owner, _worker_id, c.section, c.action,
    case c.action when 'view' then true when 'view_all' then _viewing else _editing end
  from public.permission_catalog() c
  where c.section = 'tasks'
  on conflict (worker_id, section, action) do update
    set allowed = excluded.allowed, updated_at = now();
end;
$$;
revoke execute on function public.worker_tasks_grants_from_sections(uuid) from public, anon, authenticated;

-- A grant changed: derive the coarse rights. Writes made by these triggers
-- themselves (depth > 1) are not followed again.
create or replace function public.worker_permission_grants_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  perform public.worker_permissions_derive(coalesce(new.worker_id, old.worker_id));
  return null;
end;
$$;
revoke execute on function public.worker_permission_grants_sync() from public, anon, authenticated;

create trigger worker_permission_grants_sync
  after insert or update or delete on public.worker_permission_grants
  for each row execute function public.worker_permission_grants_sync();

-- An older direct write of worker_permissions: the grants follow it.
create or replace function public.worker_permissions_to_grants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.worker_permissions;
  _view boolean := false;
  _edit boolean := false;
  _sections text[];
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'DELETE' then
    _row := old;
  else
    _row := new;
    _view := new.can_view or new.can_edit;
    _edit := new.can_edit;
  end if;
  if not exists (select 1 from public.workers w where w.id = _row.worker_id) then
    return null;
  end if;
  _sections := case _row.section::text
    when 'finance' then array['finance', 'invoices']
    else array[_row.section::text]
  end;

  insert into public.worker_permission_grants (owner_id, worker_id, section, action, allowed)
  select _row.owner_id, _row.worker_id, c.section, c.action,
    (c.kind = 'write' and _edit) or (c.kind = 'view' and _view)
  from public.permission_catalog() c
  where c.section = any (_sections)
  on conflict (worker_id, section, action) do update
    set allowed = excluded.allowed, updated_at = now();

  if _row.section::text in ('pipeline', 'contacts', 'cold_calling') then
    perform public.worker_tasks_grants_from_sections(_row.worker_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.worker_permissions_to_grants() from public, anon, authenticated;

create trigger worker_permissions_to_grants
  after insert or update or delete on public.worker_permissions
  for each row execute function public.worker_permissions_to_grants();

-- The worker's app hears a changed right at once (WorkspaceSync).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'worker_permission_grants'
     )
  then
    alter publication supabase_realtime add table public.worker_permission_grants;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fine rights on top of the section policies (restrictive: both must pass).
-- A row of the signed-in account's own space always passes; a worker's rows
-- are the owner's (the section policies already require that).
-- -----------------------------------------------------------------------------

-- Contacts: create, update (also by calling them), delete.
create policy "contacts_create_permission" on public.contacts
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'contacts', 'create'))
  );
create policy "contacts_update_permission" on public.contacts
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'contacts', 'update'))
    or (select public.has_permission(public.current_workspace_id(), 'cold_calling', 'call'))
  );
create policy "contacts_delete_permission" on public.contacts
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'contacts', 'delete'))
  );

-- Deals: all of them or only the ones in the worker's care.
create policy "deals_scope_select" on public.deals
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or assignee_id = (select auth.uid())
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'view_all'))
  );
create policy "deals_create_permission" on public.deals
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'create'))
  );
create policy "deals_scope_update" on public.deals
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or assignee_id = (select auth.uid())
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'view_all'))
  );
create policy "deals_delete_permission" on public.deals
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (select public.has_permission(public.current_workspace_id(), 'pipeline', 'delete'))
      and (
        assignee_id = (select auth.uid())
        or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'view_all'))
      )
    )
  );

-- Which fields a worker's change touches: the stage, the amount, the rest.
create or replace function public.deals_permission_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _stage boolean := new.stage_id is distinct from old.stage_id;
  _amount boolean := (new.value, new.currency) is distinct from (old.value, old.currency);
  _fields boolean := (new.title, new.description, new.contact_id, new.expected_close_date,
                      new.deadline_date, new.assignee_id)
                     is distinct from
                     (old.title, old.description, old.contact_id, old.expected_close_date,
                      old.deadline_date, old.assignee_id);
begin
  if not public.is_client_request() or auth.uid() = new.user_id then
    return new;
  end if;
  if _stage and not public.has_permission(new.user_id, 'pipeline', 'change_stage') then
    raise exception 'deal_change_stage_denied' using errcode = '42501';
  end if;
  if _amount and not public.has_permission(new.user_id, 'pipeline', 'change_amount') then
    raise exception 'deal_change_amount_denied' using errcode = '42501';
  end if;
  if _fields and not public.has_permission(new.user_id, 'pipeline', 'update') then
    raise exception 'deal_update_denied' using errcode = '42501';
  end if;
  -- The order in a column and the reason of a loss go with moving or editing.
  if not _stage
     and (new.position is distinct from old.position or new.lost_reason is distinct from old.lost_reason)
     and not public.has_permission(new.user_id, 'pipeline', 'change_stage')
     and not public.has_permission(new.user_id, 'pipeline', 'update')
  then
    raise exception 'deal_update_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.deals_permission_guard() from public, anon;

create trigger deals_permission_guard
  before update on public.deals
  for each row execute function public.deals_permission_guard();

-- The contacts of a deal are part of its details; reading them stays with
-- the section policy.
create policy "deal_contacts_insert_permission" on public.deal_contacts
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'update'))
  );
create policy "deal_contacts_update_permission" on public.deal_contacts
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'update'))
  );
create policy "deal_contacts_delete_permission" on public.deal_contacts
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'pipeline', 'update'))
  );

-- Calendar: all events or only the worker's own; create; change and delete.
create policy "calendar_events_scope_select" on public.calendar_events
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or actor_id = (select auth.uid())
    or (select public.has_permission(public.current_workspace_id(), 'calendar', 'view_all'))
  );
create policy "calendar_events_create_permission" on public.calendar_events
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'calendar', 'create'))
  );
create policy "calendar_events_update_permission" on public.calendar_events
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (select public.has_permission(public.current_workspace_id(), 'calendar', 'update'))
      and (
        actor_id = (select auth.uid())
        or (select public.has_permission(public.current_workspace_id(), 'calendar', 'view_all'))
      )
    )
  );
create policy "calendar_events_delete_permission" on public.calendar_events
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      (select public.has_permission(public.current_workspace_id(), 'calendar', 'update'))
      and (
        actor_id = (select auth.uid())
        or (select public.has_permission(public.current_workspace_id(), 'calendar', 'view_all'))
      )
    )
  );

-- Finance: income and expenses, recurring payments.
do $$
declare
  _table text;
begin
  foreach _table in array array['transactions', 'recurring_payments'] loop
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (
         (select auth.uid()) = user_id
         or (select public.has_permission(public.current_workspace_id(), ''finance'', ''view'')))',
      _table || '_finance_view', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (
         (select auth.uid()) = user_id
         or (select public.has_permission(public.current_workspace_id(), ''finance'', ''write'')))',
      _table || '_finance_insert', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (
         (select auth.uid()) = user_id
         or (select public.has_permission(public.current_workspace_id(), ''finance'', ''write'')))',
      _table || '_finance_update', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (
         (select auth.uid()) = user_id
         or (select public.has_permission(public.current_workspace_id(), ''finance'', ''write'')))',
      _table || '_finance_delete', _table
    );
  end loop;
end;
$$;

-- Invoices: reading them, and drafts with everything after (issue, send, paid, cancel).
create policy "invoices_view_permission" on public.invoices
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'invoices', 'view'))
  );
create policy "invoices_insert_permission" on public.invoices
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'invoices', 'issue'))
  );
create policy "invoices_update_permission" on public.invoices
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'invoices', 'issue'))
  );
create policy "invoices_delete_permission" on public.invoices
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.has_permission(public.current_workspace_id(), 'invoices', 'issue'))
  );

create or replace function public.require_invoice_editor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
begin
  if _ws is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission(_ws, 'invoices', 'issue') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  return _ws;
end;
$$;
revoke execute on function public.require_invoice_editor() from public, anon, authenticated;

create or replace function public.invoice_pdf_readable(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _folder text := split_part(_name, '/', 1);
begin
  if _folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.has_permission(_folder::uuid, 'invoices', 'view');
end;
$$;
revoke execute on function public.invoice_pdf_readable(text) from public, anon;
grant execute on function public.invoice_pdf_readable(text) to authenticated;

-- Cold calling: the time of the others in the space, with the right to see it.
create policy "prospecting_segments_select_others" on public.prospecting_segments
  for select to authenticated
  using (
    user_id = (select public.current_workspace_id())
    and (select public.has_permission(public.current_workspace_id(), 'cold_calling', 'view_others_stats'))
  );

create or replace function public.prospecting_daily_seconds(
  _from date,
  _to date,
  _timezone text,
  _actor uuid default null
)
returns table (day date, seconds integer)
language sql
stable
set search_path = ''
as $$
  with who as (
    select
      public.current_workspace_id() as ws,
      case
        when public.current_workspace_id() = auth.uid()
          or public.has_permission(public.current_workspace_id(), 'cold_calling', 'view_others_stats')
        then _actor
        else auth.uid()
      end as actor
  ),
  days as (
    select
      d::date as day,
      (d::date::timestamp at time zone _timezone) as day_start,
      ((d::date + 1)::timestamp at time zone _timezone) as day_end
    from generate_series(_from, least(_to, _from + 400), interval '1 day') d
  ),
  segments as (
    select s.started_at, public.prospecting_effective_end(s) as ended_at
    from public.prospecting_segments s, who
    where s.user_id = who.ws
      and (who.actor is null or s.actor_id = who.actor)
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

create or replace function public.meetings_daily(
  _from date,
  _to date,
  _timezone text,
  _actor uuid default null
)
returns table (day date, meetings integer)
language sql
stable
set search_path = ''
as $$
  with who as (
    select
      public.current_workspace_id() as ws,
      case
        when public.current_workspace_id() = auth.uid()
          or public.has_permission(public.current_workspace_id(), 'cold_calling', 'view_others_stats')
        then _actor
        else auth.uid()
      end as actor
  )
  select (m.created_at at time zone _timezone)::date as day, count(*)::integer
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  cross join who
  where m.user_id = who.ws
    and (who.actor is null or m.actor_id = who.actor)
    and t.system_key = 'meeting_scheduled'
    and m.created_at >= (_from::timestamp at time zone _timezone)
    and m.created_at < ((least(_to, _from + 400) + 1)::timestamp at time zone _timezone)
  group by 1
  order by 1;
$$;

-- -----------------------------------------------------------------------------
-- Sales tasks by the Tasks section's rights
--   read:   the owner; the person the task is given to; with "all tasks" a
--           worker who may see the deal (all deals or one in their care) or
--           the contact
--   insert: with "create" on a deal or contact the worker may see
--   update: the person it is given to (the guard keeps them to ticking it
--           off); with "update" (and "all tasks") as for reading
--   delete: with "delete", on a task they see
--   giving a task to someone else needs "assign to others"
-- -----------------------------------------------------------------------------

-- Whether the deal or the contact of a task is the signed-in worker's to see.
create or replace function public.crm_task_target_visible(_owner uuid, _deal uuid, _contact uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() = _owner
    or (
      _owner = public.current_workspace_id()
      and (
        (
          _deal is not null
          and public.has_section_access(_owner, 'pipeline', 'view')
          and (
            public.has_permission(_owner, 'pipeline', 'view_all')
            or exists (
              select 1 from public.deals d
              where d.id = _deal and d.user_id = _owner and d.assignee_id = auth.uid()
            )
          )
        )
        or (
          _contact is not null
          and (
            public.has_section_access(_owner, 'contacts', 'view')
            or public.has_section_access(_owner, 'cold_calling', 'view')
          )
        )
      )
    ),
    false
  );
$$;
revoke execute on function public.crm_task_target_visible(uuid, uuid, uuid) from public, anon;
grant execute on function public.crm_task_target_visible(uuid, uuid, uuid) to authenticated, service_role;

-- The right to change a task beyond ticking it off.
create or replace function public.crm_task_editable(_owner uuid, _deal uuid, _contact uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.uid() = _owner
    or (
      _owner = public.current_workspace_id()
      and public.has_permission(_owner, 'tasks', 'update')
      and public.crm_task_target_visible(_owner, _deal, _contact)
    ),
    false
  );
$$;
revoke execute on function public.crm_task_editable(uuid, uuid, uuid) from public, anon;
grant execute on function public.crm_task_editable(uuid, uuid, uuid) to authenticated, service_role;

drop policy "crm_tasks_select_workspace" on public.crm_tasks;
drop policy "crm_tasks_insert_workspace" on public.crm_tasks;
drop policy "crm_tasks_update_workspace" on public.crm_tasks;
drop policy "crm_tasks_delete_workspace" on public.crm_tasks;

create policy "crm_tasks_select_workspace" on public.crm_tasks
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          (select public.has_permission(public.current_workspace_id(), 'tasks', 'view_all'))
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  );

create policy "crm_tasks_insert_workspace" on public.crm_tasks
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_permission(public.current_workspace_id(), 'tasks', 'create'))
      and public.crm_task_target_visible(user_id, deal_id, contact_id)
    )
  );

create policy "crm_tasks_update_workspace" on public.crm_tasks
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          (select public.has_permission(public.current_workspace_id(), 'tasks', 'update'))
          and (select public.has_permission(public.current_workspace_id(), 'tasks', 'view_all'))
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  )
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (
        assignee_id = (select auth.uid())
        or (
          (select public.has_permission(public.current_workspace_id(), 'tasks', 'update'))
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  );

create policy "crm_tasks_delete_workspace" on public.crm_tasks
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = (select public.current_workspace_id())
      and (select public.has_permission(public.current_workspace_id(), 'tasks', 'delete'))
      and (
        assignee_id = (select auth.uid())
        or (
          (select public.has_permission(public.current_workspace_id(), 'tasks', 'view_all'))
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  );

-- Giving a task to someone else. Runs after crm_tasks_guard (alphabetical), so
-- a new task without a person is already the creator's.
create or replace function public.crm_tasks_permission_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() or auth.uid() = new.user_id then
    return new;
  end if;
  if new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not public.has_permission(new.user_id, 'tasks', 'assign_others')
  then
    raise exception 'crm_task_assign_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.crm_tasks_permission_guard() from public, anon;

create trigger crm_tasks_permission_guard
  before insert or update on public.crm_tasks
  for each row execute function public.crm_tasks_permission_guard();

-- -----------------------------------------------------------------------------
-- Company: who sees whom, who may change them
-- -----------------------------------------------------------------------------

-- The owner every worker; an active worker with Company their own branch, or
-- everyone with "see everyone". Nothing for anyone else.
create or replace function public.company_visible_worker_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid;
  _me uuid;
begin
  if _uid is null then
    return;
  end if;
  _space := public.current_workspace_id();
  if _space = _uid then
    return query select w.id from public.workers w where w.owner_id = _uid;
    return;
  end if;
  select w.id into _me from public.workers w
  where w.user_id = _uid and w.owner_id = _space and w.status = 'active';
  if _me is null or not public.has_permission(_space, 'company', 'view') then
    return;
  end if;
  if public.has_permission(_space, 'company', 'view_all') then
    return query select w.id from public.workers w where w.owner_id = _space;
    return;
  end if;
  return query
    with recursive branch (id) as (
      select _me
      union
      select w.id from public.workers w
      join branch b on w.manager_id = b.id
      where w.owner_id = _space
    )
    select branch.id from branch;
end;
$$;
revoke execute on function public.company_visible_worker_ids() from public, anon;
grant execute on function public.company_visible_worker_ids() to authenticated;

-- The photo set in Company wins over the one of the worker's own account.
create or replace function public.company_tree()
returns table (
  id uuid,
  name text,
  job_title text,
  status public.worker_status,
  manager_id uuid,
  user_id uuid,
  avatar_url text,
  display_name text,
  open_tasks integer,
  open_deals integer,
  group_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select v.id from public.company_visible_worker_ids() v (id)
  )
  select
    w.id,
    w.name,
    w.job_title,
    w.status,
    case when w.manager_id in (select visible.id from visible) then w.manager_id end,
    w.user_id,
    coalesce(w.avatar_url, p.avatar_url),
    p.display_name,
    (
      (select count(*) from public.worker_tasks t
       where t.worker_id = w.id and t.owner_id = w.owner_id and t.status <> 'done')
      + case when w.user_id is null then 0 else (
          select count(*) from public.crm_tasks c
          where c.user_id = w.owner_id and c.assignee_id = w.user_id and c.status = 'open'
        ) end
    )::integer,
    case when w.user_id is null then 0 else (
      select count(*) from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.user_id = w.owner_id and d.assignee_id = w.user_id
        and not s.is_won and not s.is_lost
    ) end::integer,
    coalesce(
      array(
        select m.group_id from public.worker_group_members m
        where m.worker_id = w.id order by m.created_at, m.group_id
      ),
      '{}'
    )
  from public.workers w
  left join public.profiles p on p.id = w.user_id
  where w.id in (select visible.id from visible)
  order by w.name, w.created_at
  limit 500;
$$;
revoke execute on function public.company_tree() from public, anon;
grant execute on function public.company_tree() to authenticated;

-- Whether the signed-in account may change this person in Company: the owner,
-- or a worker with "update" for someone they see, never themselves (their own
-- photo and phone go through company_update_worker as the person).
create or replace function public.company_can_edit_worker(_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and (
      exists (select 1 from public.workers w where w.id = _worker_id and w.owner_id = auth.uid())
      or (
        exists (
          select 1 from public.workers w
          where w.id = _worker_id
            and w.owner_id = public.current_workspace_id()
            and w.owner_id <> auth.uid()
            and w.user_id is distinct from auth.uid()
        )
        and public.has_permission(public.current_workspace_id(), 'company', 'update')
        and _worker_id in (select v.id from public.company_visible_worker_ids() v (id))
      )
    ),
    false
  );
$$;
revoke execute on function public.company_can_edit_worker(uuid) from public, anon;
grant execute on function public.company_can_edit_worker(uuid) to authenticated;

-- One person of Company with everything the dashboard shows about them.
create or replace function public.company_worker(_worker_id uuid)
returns table (
  id uuid,
  name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  description text,
  avatar_url text,
  status public.worker_status,
  manager_id uuid,
  user_id uuid,
  created_at timestamptz,
  can_edit boolean,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select v.id from public.company_visible_worker_ids() v (id)
  )
  select
    w.id,
    w.name,
    w.first_name,
    w.last_name,
    w.email,
    w.phone,
    w.job_title,
    w.description,
    coalesce(w.avatar_url, p.avatar_url),
    w.status,
    case when w.manager_id in (select visible.id from visible) then w.manager_id end,
    w.user_id,
    w.created_at,
    public.company_can_edit_worker(w.id),
    w.user_id is not distinct from auth.uid()
  from public.workers w
  left join public.profiles p on p.id = w.user_id
  where w.id = _worker_id and w.id in (select visible.id from visible);
$$;
revoke execute on function public.company_worker(uuid) from public, anon;
grant execute on function public.company_worker(uuid) to authenticated;

-- Changes a person's details. Whoever may edit them in Company changes any of
-- these; the person themself only their phone and photo.
create or replace function public.company_update_worker(_worker_id uuid, _patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _worker public.workers;
  _editor boolean;
  _self boolean;
  _key text;
  _email text;
  _phone text;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if _patch is null or jsonb_typeof(_patch) <> 'object' then
    raise exception 'worker_patch_invalid' using errcode = 'check_violation';
  end if;
  select * into _worker from public.workers where id = _worker_id for update;
  if not found then
    raise exception 'worker_not_found' using errcode = 'no_data_found';
  end if;
  _editor := public.company_can_edit_worker(_worker_id);
  _self := _worker.user_id = _uid and _worker.status = 'active';
  if not _editor and not _self then
    raise exception 'company_access_denied' using errcode = '42501';
  end if;
  for _key in select jsonb_object_keys(_patch) loop
    if _key not in ('first_name', 'last_name', 'email', 'phone', 'job_title', 'description', 'avatar_url') then
      raise exception 'worker_patch_invalid' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(_patch -> _key) not in ('string', 'null') then
      raise exception 'worker_patch_invalid' using errcode = 'check_violation';
    end if;
    if not _editor and _key not in ('phone', 'avatar_url') then
      raise exception 'company_access_denied' using errcode = '42501';
    end if;
  end loop;
  if public.workspace_read_only(_worker.owner_id) then
    raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
  end if;

  _email := nullif(lower(btrim(_patch ->> 'email')), '');
  if _patch ? 'email' and _email is not null and _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'worker_email_invalid' using errcode = 'check_violation';
  end if;
  _phone := nullif(btrim(_patch ->> 'phone'), '');
  if _patch ? 'phone' and _phone is not null and _phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'worker_phone_invalid' using errcode = 'check_violation';
  end if;

  update public.workers w set
    first_name = case when _patch ? 'first_name' then _patch ->> 'first_name' else w.first_name end,
    last_name = case when _patch ? 'last_name' then _patch ->> 'last_name' else w.last_name end,
    email = case when _patch ? 'email' then _email else w.email end,
    phone = case when _patch ? 'phone' then _phone else w.phone end,
    job_title = case when _patch ? 'job_title' then nullif(btrim(_patch ->> 'job_title'), '') else w.job_title end,
    description = case when _patch ? 'description' then _patch ->> 'description' else w.description end,
    avatar_url = case when _patch ? 'avatar_url' then nullif(btrim(_patch ->> 'avatar_url'), '') else w.avatar_url end
  where w.id = _worker_id;
end;
$$;
revoke execute on function public.company_update_worker(uuid, jsonb) from public, anon;
grant execute on function public.company_update_worker(uuid, jsonb) to authenticated;

-- Adds a person to a group of the same owner, or takes them out.
create or replace function public.company_set_group_member(_worker_id uuid, _group_id uuid, _member boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not public.company_can_edit_worker(_worker_id) then
    raise exception 'company_access_denied' using errcode = '42501';
  end if;
  select w.owner_id into _owner from public.workers w where w.id = _worker_id;
  if not exists (select 1 from public.worker_groups g where g.id = _group_id and g.owner_id = _owner) then
    raise exception 'worker_group_not_found' using errcode = 'no_data_found';
  end if;
  if _member then
    insert into public.worker_group_members (group_id, worker_id, owner_id)
    values (_group_id, _worker_id, _owner)
    on conflict (group_id, worker_id) do nothing;
  else
    delete from public.worker_group_members where group_id = _group_id and worker_id = _worker_id;
  end if;
end;
$$;
revoke execute on function public.company_set_group_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.company_set_group_member(uuid, uuid, boolean) to authenticated;

-- What a worker has in their care, for the confirmation of their removal.
create or replace function public.company_worker_impact(_worker_id uuid)
returns table (open_deals integer, open_crm_tasks integer, open_worker_tasks integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when w.user_id is null then 0 else (
      select count(*) from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.user_id = w.owner_id and d.assignee_id = w.user_id and not s.is_won and not s.is_lost
    ) end::integer,
    case when w.user_id is null then 0 else (
      select count(*) from public.crm_tasks c
      where c.user_id = w.owner_id and c.assignee_id = w.user_id and c.status = 'open'
    ) end::integer,
    (select count(*) from public.worker_tasks t
     where t.worker_id = w.id and t.owner_id = w.owner_id and t.status <> 'done')::integer
  from public.workers w
  where w.id = _worker_id and w.owner_id = auth.uid();
$$;
revoke execute on function public.company_worker_impact(uuid) from public, anon;
grant execute on function public.company_worker_impact(uuid) to authenticated;

-- Removes a worker from the company: access ends at once (status inactive),
-- the data stays. Their open deals and tasks go to _assignee (the owner or an
-- active worker) when given; their own worker tasks only to a worker. The
-- people below them move up to their manager. Works in a read-only space too,
-- only without handing anything over or moving anyone.
create or replace function public.company_remove_worker(_worker_id uuid, _assignee uuid default null)
returns table (deals integer, crm_tasks integer, worker_tasks integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _worker public.workers;
  _read_only boolean;
  _target_worker uuid;
  _deals integer := 0;
  _tasks integer := 0;
  _worker_tasks integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _worker from public.workers w
  where w.id = _worker_id and w.owner_id = _uid
  for update;
  if not found then
    raise exception 'worker_not_found' using errcode = 'no_data_found';
  end if;
  if _worker.status = 'inactive' then
    return query select 0, 0, 0;
    return;
  end if;
  _read_only := public.workspace_read_only(_uid);

  if _assignee is not null then
    if _read_only then
      raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
    end if;
    if _assignee is not distinct from _worker.user_id
       or not public.is_workspace_member(_uid, _assignee) then
      raise exception 'worker_assignee_outside' using errcode = 'check_violation';
    end if;
    if _worker.user_id is not null then
      update public.deals d
      set assignee_id = _assignee
      from public.pipeline_stages s
      where s.id = d.stage_id
        and d.user_id = _uid
        and d.assignee_id = _worker.user_id
        and not s.is_won and not s.is_lost;
      get diagnostics _deals = row_count;
      update public.crm_tasks c
      set assignee_id = _assignee
      where c.user_id = _uid and c.assignee_id = _worker.user_id and c.status = 'open';
      get diagnostics _tasks = row_count;
    end if;
    select w.id into _target_worker from public.workers w
    where w.owner_id = _uid and w.user_id = _assignee and w.status = 'active' and w.id <> _worker.id;
    if _target_worker is not null then
      update public.worker_tasks t
      set worker_id = _target_worker
      where t.worker_id = _worker.id and t.owner_id = _uid and t.status <> 'done';
      get diagnostics _worker_tasks = row_count;
    end if;
  end if;

  if not _read_only then
    update public.workers w set manager_id = _worker.manager_id
    where w.owner_id = _uid and w.manager_id = _worker.id;
  end if;
  delete from public.worker_invites i where i.worker_id = _worker.id and i.accepted_at is null;
  update public.workers w set status = 'inactive' where w.id = _worker.id;
  return query select _deals, _tasks, _worker_tasks;
end;
$$;
revoke execute on function public.company_remove_worker(uuid, uuid) from public, anon;
grant execute on function public.company_remove_worker(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Photos: worker-avatars/<owner>/<worker>/<file>, public by address like the
-- account avatars; written by whoever may edit the person, or the person.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('worker-avatars', 'worker-avatars', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function public.worker_avatar_writable(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _owner text := split_part(_name, '/', 1);
  _worker text := split_part(_name, '/', 2);
  _row public.workers;
begin
  if _owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or _worker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(_name, '/', 3) = '' or split_part(_name, '/', 4) <> '' then
    return false;
  end if;
  select * into _row from public.workers w where w.id = _worker::uuid and w.owner_id = _owner::uuid;
  if not found or public.workspace_read_only(_row.owner_id) then
    return false;
  end if;
  return public.company_can_edit_worker(_row.id)
    or (_row.user_id = auth.uid() and _row.status = 'active');
end;
$$;
revoke execute on function public.worker_avatar_writable(text) from public, anon;
grant execute on function public.worker_avatar_writable(text) to authenticated;

create policy "worker_avatars_select" on storage.objects for select to authenticated
  using (bucket_id = 'worker-avatars' and public.worker_avatar_writable(name));
create policy "worker_avatars_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'worker-avatars' and public.worker_avatar_writable(name));
create policy "worker_avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'worker-avatars' and public.worker_avatar_writable(name))
  with check (bucket_id = 'worker-avatars' and public.worker_avatar_writable(name));
create policy "worker_avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'worker-avatars' and public.worker_avatar_writable(name));

-- -----------------------------------------------------------------------------
-- Documents of a worker (contract, certificates…)
-- -----------------------------------------------------------------------------

create table public.worker_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null,
  name text not null check (char_length(name) between 1 and 200 and name = btrim(name)),
  path text not null unique,
  size bigint not null check (size between 1 and 20971520),
  mime text not null check (mime in (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'text/plain',
    'text/csv'
  )),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade,
  constraint worker_documents_path check (path = owner_id::text || '/' || worker_id::text || '/' || id::text)
);
create index worker_documents_worker_idx on public.worker_documents (worker_id, created_at desc);
create index worker_documents_owner_idx on public.worker_documents (owner_id);

create trigger set_updated_at before update on public.worker_documents
  for each row execute function public.set_updated_at();

-- The client names a new file and renames it; the rest is stamped and fixed.
create or replace function public.worker_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := auth.uid();
    new.created_at := now();
    return new;
  end if;
  if (new.owner_id, new.worker_id, new.path, new.size, new.mime, new.uploaded_by, new.created_at)
     is distinct from
     (old.owner_id, old.worker_id, old.path, old.size, old.mime, old.uploaded_by, old.created_at)
  then
    raise exception 'worker_document_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.worker_documents_guard() from public, anon;

create trigger worker_documents_guard
  before insert or update on public.worker_documents
  for each row execute function public.worker_documents_guard();
create trigger worker_documents_writable
  before insert or update or delete on public.worker_documents
  for each row execute function public.enforce_workspace_writable('owner_id');

-- The person reads their own documents while they work for the owner.
create or replace function public.worker_documents_own(_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workers w
    where w.id = _worker_id and w.user_id = auth.uid() and w.status = 'active'
  );
$$;
revoke execute on function public.worker_documents_own(uuid) from public, anon;
grant execute on function public.worker_documents_own(uuid) to authenticated;

alter table public.worker_documents enable row level security;
create policy "worker_documents_select" on public.worker_documents for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or public.worker_documents_own(worker_id)
    or public.company_can_edit_worker(worker_id)
  );
create policy "worker_documents_insert" on public.worker_documents for insert to authenticated
  with check (public.company_can_edit_worker(worker_id));
create policy "worker_documents_update" on public.worker_documents for update to authenticated
  using (public.company_can_edit_worker(worker_id))
  with check (public.company_can_edit_worker(worker_id));
create policy "worker_documents_delete" on public.worker_documents for delete to authenticated
  using (public.company_can_edit_worker(worker_id));
revoke all on public.worker_documents from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('worker-documents', 'worker-documents', false, 20971520, array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/csv'
])
on conflict (id) do nothing;

-- worker-documents/<owner>/<worker>/<document id>: read like the table, written
-- by whoever may edit the person (never in a read-only space).
create or replace function public.worker_document_object_access(_name text, _write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _owner text := split_part(_name, '/', 1);
  _worker text := split_part(_name, '/', 2);
  _row public.workers;
begin
  if _owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or _worker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(_name, '/', 3) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(_name, '/', 4) <> '' then
    return false;
  end if;
  select * into _row from public.workers w where w.id = _worker::uuid and w.owner_id = _owner::uuid;
  if not found then
    return false;
  end if;
  if _write then
    return not public.workspace_read_only(_row.owner_id) and public.company_can_edit_worker(_row.id);
  end if;
  return _row.owner_id = auth.uid()
    or public.worker_documents_own(_row.id)
    or public.company_can_edit_worker(_row.id);
end;
$$;
revoke execute on function public.worker_document_object_access(text, boolean) from public, anon;
grant execute on function public.worker_document_object_access(text, boolean) to authenticated;

create policy "worker_documents_object_select" on storage.objects for select to authenticated
  using (bucket_id = 'worker-documents' and public.worker_document_object_access(name, false));
create policy "worker_documents_object_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'worker-documents' and public.worker_document_object_access(name, true));
create policy "worker_documents_object_update" on storage.objects for update to authenticated
  using (bucket_id = 'worker-documents' and public.worker_document_object_access(name, true))
  with check (bucket_id = 'worker-documents' and public.worker_document_object_access(name, true));
create policy "worker_documents_object_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'worker-documents' and public.worker_document_object_access(name, true));

-- -----------------------------------------------------------------------------
-- Analytics: the new events (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('worker_dashboard_opened', 'workers', false),
  ('worker_profile_updated', 'workers', true),
  ('worker_permission_template_applied', 'workers', true),
  ('worker_document_uploaded', 'workers', true),
  ('worker_document_renamed', 'workers', true),
  ('worker_document_deleted', 'workers', true),
  ('worker_removed', 'workers', true)
on conflict (event) do nothing;
