-- =============================================================================
-- Dashboard of widgets (step 28.5)
--   * dashboard_layouts: the dashboards (tabs) of one person in one space, at
--     most six. items = [{id, widget, size, x, y, settings}] in the order the
--     board shows them (dashboard_items_valid). The main tab (is_default) may
--     have no items: then it follows the default (the company's or the
--     system's) live; it gets items when the person changes it, and based_on
--     says which version of the default it was made from, so a newer company
--     default is offered ("The company has a new dashboard"), never forced.
--     Only the person's own rows, only in a space they belong to; personal
--     like settings, so writable in a read-only space too.
--   * dashboard_defaults: what the owner set for the whole company, a group or
--     one person (Company → Dashboards). Only the owner reads and writes; a
--     worker gets the one that applies to them from dashboard_context().
--   * worker_dashboard_widgets: the widgets the owner lets a worker use
--     (no row = all they have data for). The owner writes, the worker reads
--     their own. The data of a widget is guarded by the policies of its
--     tables, so the list only shapes the board.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The shape of a layout (src/features/dashboard/widgets/grid.ts: cleanItems)
-- -----------------------------------------------------------------------------

create or replace function public.dashboard_items_valid(_items jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _items is not null
    and jsonb_typeof(_items) = 'array'
    and jsonb_array_length(_items) <= 40
    and octet_length(_items::text) <= 40000
    and not exists (
      select 1 from jsonb_array_elements(_items) as e(item)
      where jsonb_typeof(e.item) <> 'object'
        or coalesce(e.item ->> 'id', '') !~ '^[a-zA-Z0-9_-]{1,40}$'
        or coalesce(e.item ->> 'widget', '') !~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'
        or coalesce(e.item ->> 'size', '') not in ('S', 'M', 'L', 'XL')
        or jsonb_typeof(e.item -> 'x') is distinct from 'number'
        or jsonb_typeof(e.item -> 'y') is distinct from 'number'
        or (e.item ->> 'x')::numeric not between 0 and 3
        or (e.item ->> 'y')::numeric not between 0 and 500
        or (e.item ? 'settings' and jsonb_typeof(e.item -> 'settings') <> 'object')
        or octet_length(coalesce(e.item -> 'settings', '{}'::jsonb)::text) > 2000
    )
    and (
      select count(distinct e.item ->> 'id') = count(*)
      from jsonb_array_elements(_items) as e(item)
    );
$$;
revoke execute on function public.dashboard_items_valid(jsonb) from public, anon;
grant execute on function public.dashboard_items_valid(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- dashboard_layouts
-- -----------------------------------------------------------------------------

create table public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  -- Null only for the main tab: then it is called "Dashboard" in the user's language.
  name text,
  position smallint not null default 0,
  items jsonb,
  is_default boolean not null default false,
  based_on timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_layouts_name check (
    (name is null and is_default) or char_length(btrim(name)) between 1 and 40
  ),
  constraint dashboard_layouts_position check (position between 0 and 5),
  constraint dashboard_layouts_items check (
    (items is null and is_default) or public.dashboard_items_valid(items)
  )
);

comment on table public.dashboard_layouts is
  'Dashboards (tabs) of one person in one space (28.5). The main tab (is_default) with null items follows the default live.';

create unique index dashboard_layouts_main_idx
  on public.dashboard_layouts (user_id, space_id) where is_default;
create index dashboard_layouts_person_idx on public.dashboard_layouts (user_id, space_id, position);
create index dashboard_layouts_space_idx on public.dashboard_layouts (space_id);

create trigger set_updated_at before update on public.dashboard_layouts
  for each row execute function public.set_updated_at();

-- Six tabs at most; who and where never change; the session is the author.
create or replace function public.dashboard_layouts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      raise exception 'dashboard_layout_denied' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('dashboard_layouts:' || new.user_id || ':' || new.space_id, 0));
    if (select count(*) from public.dashboard_layouts l
        where l.user_id = new.user_id and l.space_id = new.space_id) >= 6 then
      raise exception 'dashboard_layout_limit' using errcode = 'P0001';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.space_id is distinct from old.space_id
    or new.is_default is distinct from old.is_default then
    raise exception 'dashboard_layout_fixed' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  return new;
end;
$$;
revoke execute on function public.dashboard_layouts_guard() from public, anon, authenticated;

create trigger dashboard_layouts_guard
  before insert or update on public.dashboard_layouts
  for each row execute function public.dashboard_layouts_guard();

alter table public.dashboard_layouts enable row level security;

-- Own rows, and only in a space the person belongs to now (a worker who left
-- loses that space's dashboards with it).
create policy "dashboard_layouts_own" on public.dashboard_layouts for all to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  )
  with check (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );

revoke all on public.dashboard_layouts from anon;
grant select, insert, update, delete on public.dashboard_layouts to authenticated;

-- -----------------------------------------------------------------------------
-- dashboard_defaults: the owner's dashboards for the company, a group, a person
-- -----------------------------------------------------------------------------

create table public.dashboard_defaults (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  target text not null,
  group_id uuid,
  worker_id uuid,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint dashboard_defaults_target check (
    (target = 'space' and group_id is null and worker_id is null)
    or (target = 'group' and group_id is not null and worker_id is null)
    or (target = 'worker' and worker_id is not null and group_id is null)
  ),
  constraint dashboard_defaults_items check (public.dashboard_items_valid(items)),
  constraint dashboard_defaults_group_fk foreign key (group_id, space_id)
    references public.worker_groups (id, owner_id) on delete cascade,
  constraint dashboard_defaults_worker_fk foreign key (worker_id, space_id)
    references public.workers (id, owner_id) on delete cascade
);

comment on table public.dashboard_defaults is
  'Default dashboards the owner set for the company, a group or one person (28.5); read by workers only through dashboard_context().';

create unique index dashboard_defaults_space_idx on public.dashboard_defaults (space_id)
  where target = 'space';
create unique index dashboard_defaults_group_idx on public.dashboard_defaults (group_id)
  where target = 'group';
create unique index dashboard_defaults_worker_idx on public.dashboard_defaults (worker_id)
  where target = 'worker';

-- Every save is a new version of the default: its time is what based_on compares.
create or replace function public.dashboard_defaults_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' and (new.space_id is distinct from old.space_id
    or new.target is distinct from old.target
    or new.group_id is distinct from old.group_id
    or new.worker_id is distinct from old.worker_id) then
    raise exception 'dashboard_default_fixed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.dashboard_defaults_stamp() from public, anon, authenticated;

create trigger dashboard_defaults_stamp
  before insert or update on public.dashboard_defaults
  for each row execute function public.dashboard_defaults_stamp();

alter table public.dashboard_defaults enable row level security;

create policy "dashboard_defaults_owner_all" on public.dashboard_defaults for all to authenticated
  using ((select auth.uid()) = space_id) with check ((select auth.uid()) = space_id);

revoke all on public.dashboard_defaults from anon;
grant select, insert, update, delete on public.dashboard_defaults to authenticated;

-- -----------------------------------------------------------------------------
-- worker_dashboard_widgets: the widgets a worker may use
-- -----------------------------------------------------------------------------

create table public.worker_dashboard_widgets (
  worker_id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  widgets text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint worker_dashboard_widgets_worker_fk foreign key (worker_id, owner_id)
    references public.workers (id, owner_id) on delete cascade,
  constraint worker_dashboard_widgets_list check (
    cardinality(widgets) <= 60
    and array_to_string(widgets, ',') ~ '^([a-zA-Z][a-zA-Z0-9]{0,39}(,[a-zA-Z][a-zA-Z0-9]{0,39})*)?$'
  )
);

create index worker_dashboard_widgets_owner_idx on public.worker_dashboard_widgets (owner_id);

create trigger set_updated_at before update on public.worker_dashboard_widgets
  for each row execute function public.set_updated_at();

alter table public.worker_dashboard_widgets enable row level security;

create policy "worker_dashboard_widgets_owner_all" on public.worker_dashboard_widgets
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "worker_dashboard_widgets_self_select" on public.worker_dashboard_widgets
  for select to authenticated
  using (worker_id in (select public.my_worker_ids()));

revoke all on public.worker_dashboard_widgets from anon;
grant select, insert, update, delete on public.worker_dashboard_widgets to authenticated;

-- -----------------------------------------------------------------------------
-- dashboard_context(space): the default that applies to the signed-in person
-- in that space (a person's > a group's > the company's; none for the owner,
-- whose default is the system's) and the widgets they may use.
-- -----------------------------------------------------------------------------

create or replace function public.dashboard_context(_space uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _worker uuid;
  _row record;
  _allowed text[];
  _group_name text;
begin
  if _uid is null or _space is null or not (_space = any (public.member_spaces())) then
    return null;
  end if;
  if _space = _uid then
    return jsonb_build_object('source', null, 'items', null, 'updated_at', null, 'allowed', null);
  end if;

  select m.worker_id into _worker from public.memberships m
  where m.user_id = _uid and m.space_id = _space and m.role = 'worker' and m.status = 'active'
  limit 1;
  if _worker is null then
    return null;
  end if;

  select w.widgets into _allowed from public.worker_dashboard_widgets w
  where w.worker_id = _worker and w.owner_id = _space;

  select d.target, d.items, d.updated_at into _row from public.dashboard_defaults d
  where d.space_id = _space and d.target = 'worker' and d.worker_id = _worker;

  if _row is null then
    select d.target, d.items, d.updated_at, g.name as group_name into _row
    from public.dashboard_defaults d
    join public.worker_groups g on g.id = d.group_id and g.owner_id = _space
    join public.worker_group_members gm on gm.group_id = g.id and gm.worker_id = _worker
    where d.space_id = _space and d.target = 'group'
    order by g.position, lower(g.name), g.id
    limit 1;
    if _row is not null then
      _group_name := _row.group_name;
    end if;
  end if;

  if _row is null then
    select d.target, d.items, d.updated_at into _row from public.dashboard_defaults d
    where d.space_id = _space and d.target = 'space';
  end if;

  return jsonb_build_object(
    'source', case when _row is null then null else _row.target end,
    'group_name', _group_name,
    'items', case when _row is null then null else _row.items end,
    'updated_at', case when _row is null then null else _row.updated_at end,
    'allowed', case when _allowed is null then null else to_jsonb(_allowed) end
  );
end;
$$;
revoke execute on function public.dashboard_context(uuid) from public, anon;
grant execute on function public.dashboard_context(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: what is placed where, never names or data
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('dashboard_edit_started', 'dashboard', false),
  ('dashboard_widget_added', 'dashboard', true),
  ('dashboard_widget_removed', 'dashboard', true),
  ('dashboard_widget_resized', 'dashboard', true),
  ('dashboard_widget_moved', 'dashboard', true),
  ('dashboard_widget_settings_saved', 'dashboard', true),
  ('dashboard_widget_opened', 'dashboard', false),
  ('dashboard_layout_created', 'dashboard', true),
  ('dashboard_layout_renamed', 'dashboard', true),
  ('dashboard_layout_deleted', 'dashboard', true),
  ('dashboard_layout_reset', 'dashboard', true),
  ('dashboard_default_offer', 'dashboard', true),
  ('dashboard_default_saved', 'workers', true),
  ('dashboard_widgets_allowed', 'workers', true)
on conflict (event) do nothing;
