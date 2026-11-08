-- =============================================================================
-- One account, several companies (step 22.4)
--   * A space is still the owner's user id: every shared row keeps
--     user_id = the owner. Nothing is renamed; this migration only adds.
--   * memberships: who belongs to which space. Every account owns its own
--     space (role owner); an account the owner took on is a worker there
--     (role worker, the worker record next to it). The database keeps the rows
--     in step with workers by itself; the client never writes them.
--   * The active space comes with every request: the app sends the space the
--     person picked (cookie active_space) as the header x-gradus-space and
--     current_workspace_id() takes it only when the account is a member there.
--     Without it (or with a space the account does not belong to) it is the
--     default: the first company the account works for, else its own, as
--     before this step.
--   * Row level security goes by membership, never by the active space: a row
--     is visible when its space is one the account belongs to with the right
--     for it. The active space only picks which of them the app shows (every
--     query filters by it) and where functions act. Realtime and Storage,
--     which carry no header, see the same rows as before.
--   * profiles.public_id: the short id of an account (six characters without
--     look-alikes), shown in Settings → Account, searched in the administration.
--   * profiles.company_name / company_logo_url: how the owner's company shows
--     in the space switcher of the people who work there.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Short id, company name and logo of an account (filled further down)
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column public_id text,
  add column company_name text,
  add column company_logo_url text,
  add constraint profiles_public_id_format check (public_id is null or public_id ~ '^[2-9A-HJKMNP-TV-Z]{6}$'),
  add constraint profiles_company_name_length check (
    company_name is null or char_length(btrim(company_name)) between 1 and 80
  ),
  add constraint profiles_company_logo_url_length check (
    company_logo_url is null or char_length(company_logo_url) <= 600
  );

create unique index profiles_public_id_idx on public.profiles (public_id);

-- -----------------------------------------------------------------------------
-- Memberships
-- -----------------------------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'worker')),
  worker_id uuid references public.workers (id) on delete cascade,
  status text not null check (status in ('invited', 'active', 'left', 'removed')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, space_id),
  -- The own space has no worker record; a company's worker always has one.
  constraint memberships_role_shape check (
    (role = 'owner' and user_id = space_id and worker_id is null)
    or (role = 'worker' and user_id <> space_id and worker_id is not null)
  )
);

create index memberships_space_idx on public.memberships (space_id, status);
create index memberships_worker_idx on public.memberships (worker_id);
create index memberships_user_active_idx on public.memberships (user_id, status, joined_at);

alter table public.memberships enable row level security;

-- One's own memberships, and the owner the memberships of their space.
create policy memberships_select_own on public.memberships
  for select to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = space_id);

revoke all on table public.memberships from anon;
revoke insert, update, delete on table public.memberships from authenticated;
grant select on table public.memberships to authenticated;
grant all on table public.memberships to service_role;

-- What a worker record means for the account behind it.
create or replace function public.membership_status_of(_status public.worker_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case _status
    when 'active' then 'active'
    when 'invited' then 'invited'
    else 'removed'
  end;
$$;
revoke execute on function public.membership_status_of(public.worker_status) from public, anon;

-- The worker record decides; the membership follows in the same transaction.
create or replace function public.workers_sync_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _status text;
begin
  -- The account behind the record changed (or went): it is no longer a member.
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
    update public.memberships
    set status = 'removed', left_at = coalesce(left_at, now()), updated_at = now()
    where worker_id = old.id and user_id = old.user_id and status <> 'removed';
  end if;
  if new.user_id is null or new.user_id = new.owner_id then
    return new;
  end if;
  _status := public.membership_status_of(new.status);
  insert into public.memberships (user_id, space_id, role, worker_id, status, joined_at, left_at)
  values (
    new.user_id, new.owner_id, 'worker', new.id, _status,
    case when _status = 'active' then now() end,
    case when _status in ('left', 'removed') then now() end
  )
  on conflict (user_id, space_id) do update
  set worker_id = excluded.worker_id,
      role = 'worker',
      status = excluded.status,
      joined_at = case
        when excluded.status = 'active' then coalesce(public.memberships.joined_at, now())
        else public.memberships.joined_at
      end,
      left_at = case
        when excluded.status = 'active' then null
        when public.memberships.status = 'active' then now()
        else coalesce(public.memberships.left_at, excluded.left_at)
      end,
      updated_at = now()
  where (public.memberships.worker_id, public.memberships.status)
        is distinct from (excluded.worker_id, excluded.status);
  return new;
end;
$$;
revoke execute on function public.workers_sync_membership() from public, anon, authenticated;

create trigger workers_sync_membership
  after insert or update of user_id, status, owner_id on public.workers
  for each row execute function public.workers_sync_membership();

-- Every account owns its own space, except an account made only to enter the
-- administration (it has no workspace).
create or replace function public.profiles_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from auth.users u
    where u.id = new.id and u.raw_user_meta_data ->> 'admin_invite' = 'true'
  ) then
    return new;
  end if;
  insert into public.memberships (user_id, space_id, role, status, joined_at)
  values (new.id, new.id, 'owner', 'active', coalesce(new.created_at, now()))
  on conflict (user_id, space_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.profiles_owner_membership() from public, anon, authenticated;

create trigger profiles_owner_membership
  after insert on public.profiles
  for each row execute function public.profiles_owner_membership();

-- Existing accounts: owners of their own space, and workers where they work.
insert into public.memberships (user_id, space_id, role, status, joined_at, created_at)
select p.id, p.id, 'owner', 'active', p.created_at, p.created_at
from public.profiles p
join auth.users u on u.id = p.id
where coalesce(u.raw_user_meta_data ->> 'admin_invite', '') <> 'true'
on conflict (user_id, space_id) do nothing;

insert into public.memberships (user_id, space_id, role, worker_id, status, joined_at, left_at, created_at)
select
  w.user_id,
  w.owner_id,
  'worker',
  w.id,
  public.membership_status_of(w.status),
  case when w.status <> 'invited' then coalesce(
    (select min(i.accepted_at) from public.worker_invites i where i.worker_id = w.id and i.accepted_by = w.user_id),
    w.created_at
  ) end,
  case when w.status = 'inactive' then w.updated_at end,
  w.created_at
from public.workers w
where w.user_id is not null and w.user_id <> w.owner_id
on conflict (user_id, space_id) do nothing;

-- An account may now work for any number of companies (one record per company stays).
drop index if exists public.workers_one_employer_idx;

-- -----------------------------------------------------------------------------
-- Membership checks
-- -----------------------------------------------------------------------------

-- Whether the signed-in account belongs to this space: its own, or a company
-- it actively works for.
create or replace function public.is_space_member(_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and _space is not null
    and (
      _space = auth.uid()
      or exists (
        select 1 from public.memberships m
        where m.user_id = auth.uid()
          and m.space_id = _space
          and m.role = 'worker'
          and m.status = 'active'
      )
    ),
    false
  );
$$;
revoke execute on function public.is_space_member(uuid) from public, anon;
grant execute on function public.is_space_member(uuid) to authenticated, service_role;

-- The spaces the signed-in account belongs to: its own first, then the
-- companies it actively works for. One array per statement for the policies.
create or replace function public.member_spaces()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '{}'::uuid[] else array(
    select auth.uid()
    union all
    select m.space_id from public.memberships m
    where m.user_id = auth.uid() and m.role = 'worker' and m.status = 'active'
  ) end;
$$;
revoke execute on function public.member_spaces() from public, anon;
grant execute on function public.member_spaces() to authenticated, service_role;

-- The spaces where has_section_access(space, section, level) holds.
create or replace function public.section_spaces(_section text, _level text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '{}'::uuid[] else array(
    select auth.uid()
    union all
    select m.space_id
    from public.memberships m
    join public.worker_permissions p on p.worker_id = m.worker_id
    where m.user_id = auth.uid()
      and m.role = 'worker'
      and m.status = 'active'
      and _section in ('milestones', 'contacts', 'pipeline', 'cold_calling', 'calendar', 'finance')
      and _level in ('view', 'edit')
      and p.section::text = _section
      and case when _level = 'edit' then p.can_edit else p.can_view end
  ) end;
$$;
revoke execute on function public.section_spaces(text, text) from public, anon;
grant execute on function public.section_spaces(text, text) to authenticated, service_role;

-- The spaces where has_permission(space, section, action) holds.
create or replace function public.permitted_spaces(_section text, _action text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.permission_action_valid(_section, _action) then '{}'::uuid[]
    else array(
      select auth.uid()
      union all
      select m.space_id
      from public.memberships m
      where m.user_id = auth.uid()
        and m.role = 'worker'
        and m.status = 'active'
        and public.worker_grant(m.worker_id, _section, 'view')
        and public.worker_grant(m.worker_id, _section, _action)
    )
  end;
$$;
revoke execute on function public.permitted_spaces(text, text) from public, anon;
grant execute on function public.permitted_spaces(text, text) to authenticated, service_role;

-- Section access by membership (was: by the worker record). Same answers.
create or replace function public.has_section_access(_owner uuid, _section text, _level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and _owner is not null
    and (
      _owner = auth.uid()
      or (
        _section in ('milestones', 'contacts', 'pipeline', 'cold_calling', 'calendar', 'finance')
        and _level in ('view', 'edit')
        and exists (
          select 1
          from public.memberships m
          join public.worker_permissions p on p.worker_id = m.worker_id
          where m.space_id = _owner
            and m.user_id = auth.uid()
            and m.role = 'worker'
            and m.status = 'active'
            and p.section::text = _section
            and case when _level = 'edit' then p.can_edit else p.can_view end
        )
      )
    ),
    false
  );
$$;

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
        select 1 from public.memberships m
        where m.space_id = _owner
          and m.user_id = auth.uid()
          and m.role = 'worker'
          and m.status = 'active'
          and public.worker_grant(m.worker_id, _section, 'view')
          and public.worker_grant(m.worker_id, _section, _action)
      )
    ),
    false
  );
$$;

-- Whether _user belongs to the space of _owner (the owner or an active worker),
-- asked by someone of that space.
create or replace function public.is_workspace_member(_owner uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    _owner is not null
    and _user is not null
    and (auth.uid() is null or _owner = auth.uid() or public.is_space_member(_owner))
    and (
      _user = _owner
      or exists (
        select 1 from public.memberships m
        where m.space_id = _owner and m.user_id = _user and m.role = 'worker' and m.status = 'active'
      )
    ),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- The active space
-- -----------------------------------------------------------------------------

-- The space the request asks for (header x-gradus-space), unchecked.
create or replace function public.requested_space()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  _value text;
begin
  _value := nullif(current_setting('request.headers', true), '')::json ->> 'x-gradus-space';
  if _value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return _value::uuid;
  end if;
  return null;
end;
$$;
revoke execute on function public.requested_space() from public, anon;
grant execute on function public.requested_space() to authenticated, service_role;

-- Where an account works when it picked nothing (or something it may not):
-- the first company it works for, else its own space. As before step 22.4.
create or replace function public.default_space_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select m.space_id from public.memberships m
      where m.user_id = auth.uid() and m.role = 'worker' and m.status = 'active'
      order by m.joined_at nulls last, m.created_at, m.space_id
      limit 1
    ),
    auth.uid()
  );
$$;
revoke execute on function public.default_space_id() from public, anon;
grant execute on function public.default_space_id() to authenticated, service_role;

-- The space the signed-in account works in for this request: the one asked
-- for when it belongs there, otherwise its default.
create or replace function public.current_workspace_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _requested uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  _requested := public.requested_space();
  if _requested is not null and public.is_space_member(_requested) then
    return _requested;
  end if;
  return public.default_space_id();
end;
$$;

-- The switcher: the own space first, then every company the account works
-- for, with the company's name and logo (an owner's profile is otherwise not
-- readable by their workers). Never another account's e-mail.
create or replace function public.my_spaces()
returns table (
  space_id uuid,
  role text,
  worker_id uuid,
  company_name text,
  logo_url text,
  owner_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.space_id, s.role, s.worker_id, s.company_name, s.logo_url, s.owner_name
  from (
    select
      auth.uid() as space_id,
      'owner'::text as role,
      null::uuid as worker_id,
      coalesce(p.company_name, ip.name) as company_name,
      p.company_logo_url as logo_url,
      p.display_name as owner_name,
      0 as rank
    from public.profiles p
    left join public.invoice_profiles ip on ip.user_id = p.id
    where p.id = auth.uid()
    union all
    select
      m.space_id,
      'worker',
      m.worker_id,
      coalesce(p.company_name, ip.name),
      p.company_logo_url,
      p.display_name,
      1
    from public.memberships m
    join public.workers w on w.id = m.worker_id and w.status = 'active'
    left join public.profiles p on p.id = m.space_id
    left join public.invoice_profiles ip on ip.user_id = m.space_id
    where m.user_id = auth.uid() and m.role = 'worker' and m.status = 'active'
  ) s
  order by s.rank, lower(coalesce(s.company_name, s.owner_name, '')), s.space_id
  limit 50;
$$;
revoke execute on function public.my_spaces() from public, anon;
grant execute on function public.my_spaces() to authenticated;

-- -----------------------------------------------------------------------------
-- The shared sections (contacts, milestones, pipeline, calendar, finance):
--   read:  own space, or a space where has_section_access(…, 'view') holds
--   write: own space, or a space where has_section_access(…, 'edit') holds
-- One array per statement (section_spaces), compared with the row's space.
-- -----------------------------------------------------------------------------

do $$
declare
  _spec record;
  _view text;
  _edit text;
  _level text;
  _check text;
begin
  for _spec in
    select * from (values
      ('contacts', array['contacts', 'cold_calling'], true),
      ('contact_tables', array['contacts', 'cold_calling'], true),
      ('contact_table_fields', array['contacts', 'cold_calling'], true),
      ('contact_activities', array['contacts', 'cold_calling'], true),
      ('contact_table_entries', array['contacts', 'cold_calling'], false),
      ('contact_table_moves', array['contacts', 'cold_calling'], false),
      ('milestones', array['milestones'], true),
      ('tasks', array['milestones'], true),
      ('pipeline_stages', array['pipeline'], true),
      ('deals', array['pipeline'], true),
      ('meeting_surveys', array['pipeline'], true),
      ('calendar_events', array['calendar'], true),
      ('invoices', array['finance'], true),
      ('recurring_payments', array['finance'], true),
      ('transactions', array['finance'], true)
    ) as t(name, sections, writable)
  loop
    foreach _level in array array['view', 'edit'] loop
      select format(
        '((select auth.uid()) = user_id or %s)',
        string_agg(
          format('user_id = any ((select public.section_spaces(%L, %L))::uuid[])', s, _level),
          ' or '
        )
      )
      into _check
      from unnest(_spec.sections) s;
      if _level = 'view' then _view := _check; else _edit := _check; end if;
    end loop;

    execute format('drop policy if exists %I on public.%I', _spec.name || '_select_workspace', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_insert_workspace', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_update_workspace', _spec.name);
    execute format('drop policy if exists %I on public.%I', _spec.name || '_delete_workspace', _spec.name);

    execute format(
      'create policy %I on public.%I for select to authenticated using %s',
      _spec.name || '_select_workspace', _spec.name, _view
    );
    if _spec.writable then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check %s',
        _spec.name || '_insert_workspace', _spec.name, _edit
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using %s with check %s',
        _spec.name || '_update_workspace', _spec.name, _edit, _edit
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using %s',
        _spec.name || '_delete_workspace', _spec.name, _edit
      );
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sales tasks: by membership, not by the active space
-- -----------------------------------------------------------------------------

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
      public.is_space_member(_owner)
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

create or replace function public.crm_task_editable(_owner uuid, _deal uuid, _contact uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.uid() = _owner
    or (
      public.is_space_member(_owner)
      and public.has_permission(_owner, 'tasks', 'update')
      and public.crm_task_target_visible(_owner, _deal, _contact)
    ),
    false
  );
$$;

drop policy if exists "crm_tasks_select_workspace" on public.crm_tasks;
drop policy if exists "crm_tasks_insert_workspace" on public.crm_tasks;
drop policy if exists "crm_tasks_update_workspace" on public.crm_tasks;
drop policy if exists "crm_tasks_delete_workspace" on public.crm_tasks;

create policy "crm_tasks_select_workspace" on public.crm_tasks
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.member_spaces())::uuid[])
      and (
        assignee_id = (select auth.uid())
        or (
          user_id = any ((select public.permitted_spaces('tasks', 'view_all'))::uuid[])
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
      user_id = any ((select public.permitted_spaces('tasks', 'create'))::uuid[])
      and public.crm_task_target_visible(user_id, deal_id, contact_id)
    )
  );

create policy "crm_tasks_update_workspace" on public.crm_tasks
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.member_spaces())::uuid[])
      and (
        assignee_id = (select auth.uid())
        or (
          user_id = any ((select public.permitted_spaces('tasks', 'update'))::uuid[])
          and user_id = any ((select public.permitted_spaces('tasks', 'view_all'))::uuid[])
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  )
  with check (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.member_spaces())::uuid[])
      and (
        assignee_id = (select auth.uid())
        or (
          user_id = any ((select public.permitted_spaces('tasks', 'update'))::uuid[])
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
      user_id = any ((select public.permitted_spaces('tasks', 'delete'))::uuid[])
      and (
        assignee_id = (select auth.uid())
        or (
          user_id = any ((select public.permitted_spaces('tasks', 'view_all'))::uuid[])
          and public.crm_task_target_visible(user_id, deal_id, contact_id)
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Fine rights (restrictive): the rights of the row's space, not of the
-- active one, so a right in one company never opens a row of another.
-- -----------------------------------------------------------------------------

drop policy if exists "contacts_create_permission" on public.contacts;
drop policy if exists "contacts_update_permission" on public.contacts;
drop policy if exists "contacts_delete_permission" on public.contacts;

create policy "contacts_create_permission" on public.contacts
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('contacts', 'create'))::uuid[])
  );
create policy "contacts_update_permission" on public.contacts
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('contacts', 'update'))::uuid[])
    or user_id = any ((select public.permitted_spaces('cold_calling', 'call'))::uuid[])
  );
create policy "contacts_delete_permission" on public.contacts
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('contacts', 'delete'))::uuid[])
  );

drop policy if exists "deals_scope_select" on public.deals;
drop policy if exists "deals_create_permission" on public.deals;
drop policy if exists "deals_scope_update" on public.deals;
drop policy if exists "deals_delete_permission" on public.deals;

create policy "deals_scope_select" on public.deals
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (assignee_id = (select auth.uid()) and user_id = any ((select public.member_spaces())::uuid[]))
    or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
  );
create policy "deals_create_permission" on public.deals
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('pipeline', 'create'))::uuid[])
  );
create policy "deals_scope_update" on public.deals
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (assignee_id = (select auth.uid()) and user_id = any ((select public.member_spaces())::uuid[]))
    or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
  );
create policy "deals_delete_permission" on public.deals
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('pipeline', 'delete'))::uuid[])
      and (
        assignee_id = (select auth.uid())
        or user_id = any ((select public.permitted_spaces('pipeline', 'view_all'))::uuid[])
      )
    )
  );

drop policy if exists "deal_contacts_insert_permission" on public.deal_contacts;
drop policy if exists "deal_contacts_update_permission" on public.deal_contacts;
drop policy if exists "deal_contacts_delete_permission" on public.deal_contacts;

create policy "deal_contacts_insert_permission" on public.deal_contacts
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
  );
create policy "deal_contacts_update_permission" on public.deal_contacts
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
  );
create policy "deal_contacts_delete_permission" on public.deal_contacts
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('pipeline', 'update'))::uuid[])
  );

drop policy if exists "calendar_events_scope_select" on public.calendar_events;
drop policy if exists "calendar_events_create_permission" on public.calendar_events;
drop policy if exists "calendar_events_update_permission" on public.calendar_events;
drop policy if exists "calendar_events_delete_permission" on public.calendar_events;

create policy "calendar_events_scope_select" on public.calendar_events
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (actor_id = (select auth.uid()) and user_id = any ((select public.member_spaces())::uuid[]))
    or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
  );
create policy "calendar_events_create_permission" on public.calendar_events
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('calendar', 'create'))::uuid[])
  );
create policy "calendar_events_update_permission" on public.calendar_events
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('calendar', 'update'))::uuid[])
      and (
        actor_id = (select auth.uid())
        or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
      )
    )
  );
create policy "calendar_events_delete_permission" on public.calendar_events
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      user_id = any ((select public.permitted_spaces('calendar', 'update'))::uuid[])
      and (
        actor_id = (select auth.uid())
        or user_id = any ((select public.permitted_spaces('calendar', 'view_all'))::uuid[])
      )
    )
  );

do $$
declare
  _table text;
begin
  foreach _table in array array['transactions', 'recurring_payments'] loop
    execute format('drop policy if exists %I on public.%I', _table || '_finance_view', _table);
    execute format('drop policy if exists %I on public.%I', _table || '_finance_insert', _table);
    execute format('drop policy if exists %I on public.%I', _table || '_finance_update', _table);
    execute format('drop policy if exists %I on public.%I', _table || '_finance_delete', _table);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''view''))::uuid[]))',
      _table || '_finance_view', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_insert', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_update', _table
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (
         (select auth.uid()) = user_id
         or user_id = any ((select public.permitted_spaces(''finance'', ''write''))::uuid[]))',
      _table || '_finance_delete', _table
    );
  end loop;
end;
$$;

drop policy if exists "invoices_view_permission" on public.invoices;
drop policy if exists "invoices_insert_permission" on public.invoices;
drop policy if exists "invoices_update_permission" on public.invoices;
drop policy if exists "invoices_delete_permission" on public.invoices;

create policy "invoices_view_permission" on public.invoices
  as restrictive for select to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('invoices', 'view'))::uuid[])
  );
create policy "invoices_insert_permission" on public.invoices
  as restrictive for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('invoices', 'issue'))::uuid[])
  );
create policy "invoices_update_permission" on public.invoices
  as restrictive for update to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('invoices', 'issue'))::uuid[])
  );
create policy "invoices_delete_permission" on public.invoices
  as restrictive for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.permitted_spaces('invoices', 'issue'))::uuid[])
  );

-- -----------------------------------------------------------------------------
-- Section policies that went through the active space
-- -----------------------------------------------------------------------------

drop policy if exists deal_events_select_workspace on public.deal_events;
create policy deal_events_select_workspace on public.deal_events
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'view'))::uuid[])
  );

drop policy if exists deal_contacts_select_workspace on public.deal_contacts;
drop policy if exists deal_contacts_insert_workspace on public.deal_contacts;
drop policy if exists deal_contacts_update_workspace on public.deal_contacts;
drop policy if exists deal_contacts_delete_workspace on public.deal_contacts;

create policy deal_contacts_select_workspace on public.deal_contacts
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'view'))::uuid[])
  );
create policy deal_contacts_insert_workspace on public.deal_contacts
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'edit'))::uuid[])
  );
create policy deal_contacts_update_workspace on public.deal_contacts
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'edit'))::uuid[])
  )
  with check (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'edit'))::uuid[])
  );
create policy deal_contacts_delete_workspace on public.deal_contacts
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('pipeline', 'edit'))::uuid[])
  );

drop policy if exists invoice_profiles_select_workspace on public.invoice_profiles;
create policy invoice_profiles_select_workspace on public.invoice_profiles
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or user_id = any ((select public.section_spaces('finance', 'view'))::uuid[])
  );

-- Every account owns its space now, so its own billing details are its own to keep.
drop policy if exists billing_profiles_insert_own on public.billing_profiles;
drop policy if exists billing_profiles_update_own on public.billing_profiles;
create policy billing_profiles_insert_own on public.billing_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy billing_profiles_update_own on public.billing_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "prospecting_segments_select_workspace" on public.prospecting_segments;
create policy "prospecting_segments_select_workspace" on public.prospecting_segments
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      actor_id = (select auth.uid())
      and user_id = any ((select public.section_spaces('cold_calling', 'view'))::uuid[])
    )
  );

drop policy if exists "prospecting_segments_select_others" on public.prospecting_segments;
create policy "prospecting_segments_select_others" on public.prospecting_segments
  for select to authenticated
  using (user_id = any ((select public.permitted_spaces('cold_calling', 'view_others_stats'))::uuid[]));

-- -----------------------------------------------------------------------------
-- Company: who may change a person is a question about the person's company
-- -----------------------------------------------------------------------------

create or replace function public.company_visible_worker_ids_in(_space uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _me uuid;
begin
  if _uid is null or _space is null then
    return;
  end if;
  if _space = _uid then
    return query select w.id from public.workers w where w.owner_id = _uid;
    return;
  end if;
  select m.worker_id into _me from public.memberships m
  join public.workers w on w.id = m.worker_id and w.status = 'active'
  where m.user_id = _uid and m.space_id = _space and m.role = 'worker' and m.status = 'active';
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
revoke execute on function public.company_visible_worker_ids_in(uuid) from public, anon;
grant execute on function public.company_visible_worker_ids_in(uuid) to authenticated;

-- Company as the active space shows it.
create or replace function public.company_visible_worker_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.company_visible_worker_ids_in(public.current_workspace_id()) v (id);
$$;

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
      or exists (
        select 1 from public.workers w
        where w.id = _worker_id
          and w.owner_id <> auth.uid()
          and w.user_id is distinct from auth.uid()
          and public.has_permission(w.owner_id, 'company', 'update')
          and w.id in (select v.id from public.company_visible_worker_ids_in(w.owner_id) v (id))
      )
    ),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- Short id, company name and logo
-- -----------------------------------------------------------------------------



-- Six characters without 0/O, 1/I/L or U (as the error codes), never taken.
create or replace function public.new_public_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  _bytes bytea;
  _id text;
begin
  loop
    _bytes := uuid_send(gen_random_uuid());
    _id := '';
    for _i in 0..5 loop
      _id := _id || substr(_alphabet, (get_byte(_bytes, _i) % 30) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.profiles p where p.public_id = _id);
  end loop;
  return _id;
end;
$$;
revoke execute on function public.new_public_id() from public, anon;
grant execute on function public.new_public_id() to authenticated, service_role;

-- The database picks the short id once; nobody changes it from the app.
create or replace function public.profiles_public_id_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.public_id is null or public.is_client_request() then
      new.public_id := public.new_public_id();
    end if;
    return new;
  end if;
  if old.public_id is not null then
    new.public_id := old.public_id;
  elsif new.public_id is null or public.is_client_request() then
    new.public_id := public.new_public_id();
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_public_id_guard() from public, anon, authenticated;

create trigger profiles_public_id_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_public_id_guard();

do $$
declare
  _profile uuid;
begin
  for _profile in select id from public.profiles where public_id is null order by created_at loop
    update public.profiles set public_id = public.new_public_id() where id = _profile;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Administration: the user search also finds the short id
-- -----------------------------------------------------------------------------

create or replace function public.metric_admin_users(
  _tz text default 'Europe/Prague',
  _query text default null,
  _sort text default 'activity',
  _limit integer default 50,
  _offset integer default 0,
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (
  user_id uuid,
  plan text,
  status text,
  mode text,
  industry text,
  country text,
  role text,
  is_internal boolean,
  signed_up_at timestamptz,
  last_active_at timestamptz,
  ai_cost_usd numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _q text := nullif(btrim(coalesce(_query, '')), '');
  -- The query normalized, its own LIKE wildcards escaped.
  _literal text := replace(replace(replace(public.search_norm(_q), '\', '\\'), '%', '\%'), '_', '\_');
  -- The query read as (the beginning of) a short id: letters and digits only.
  _public text := case
    when upper(regexp_replace(coalesce(_q, ''), '[^0-9A-Za-z]', '', 'g')) ~ '^[0-9A-Z]{3,6}$'
      then upper(regexp_replace(_q, '[^0-9A-Za-z]', '', 'g'))
  end;
  _users uuid[] := public.metric_users(_tz, coalesce(_include_internal, false), coalesce(_segment, '{}'));
begin
  return query
  with activity as (
    select e.user_id, max(e.created_at) as last_active_at
    from public.analytics_events e
    where e.user_id = any(_users)
    group by e.user_id
  ),
  cost as (
    select a.user_id, sum(a.cost_usd) as ai_cost_usd
    from public.ai_usage a
    where a.user_id = any(_users)
    group by a.user_id
  )
  select
    d.user_id, cp.plan_key, cp.status, d.mode, d.industry, d.country, d.role, d.is_internal,
    d.signed_up_at, act.last_active_at, coalesce(c.ai_cost_usd, 0)
  from public.metric_user_dims(_tz) d
  cross join lateral public.current_plan(d.user_id) cp
  left join activity act on act.user_id = d.user_id
  left join cost c on c.user_id = d.user_id
  left join public.profiles p on p.id = d.user_id
  left join auth.users u on u.id = d.user_id
  where d.user_id = any(_users)
    and (
      _q is null
      or d.user_id::text like (_literal || '%') escape '\'
      or public.search_norm(p.display_name) like ('%' || _literal || '%') escape '\'
      or public.search_norm(u.email) like ('%' || _literal || '%') escape '\'
      or (_public is not null and p.public_id like (_public || '%'))
    )
  order by
    case when _sort = 'cost' then coalesce(c.ai_cost_usd, 0) end desc nulls last,
    case when _sort = 'signup' then d.signed_up_at end desc nulls last,
    act.last_active_at desc nulls last,
    d.signed_up_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
end;
$$;

revoke all on function public.metric_admin_users(text, text, text, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_admin_users(text, text, text, integer, integer, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('space_switched', 'account', false)
on conflict (event) do nothing;

-- -----------------------------------------------------------------------------
-- A worker's own records (tasks from the owner, rights, earnings) stay theirs
-- to see only while they work there, like everything else of that company.
-- -----------------------------------------------------------------------------

create or replace function public.my_worker_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.worker_id from public.memberships m
  where m.user_id = auth.uid() and m.role = 'worker' and m.status = 'active';
$$;

-- The company-wide reward rules: only for the people who work there now.
drop policy if exists "reward_rules_worker_select" on public.reward_rules;
create policy "reward_rules_worker_select" on public.reward_rules for select to authenticated
  using (
    worker_id in (select public.my_worker_ids())
    or (worker_id is null and owner_id = any ((select public.member_spaces())::uuid[]))
  );
