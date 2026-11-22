-- =============================================================================
-- Notes: folders and sharing inside a company (step 28.3)
--   * notes.space_id: the space a note belongs to (its own for every note so
--     far). A note written in a company stays that company's; its owner is
--     still notes.user_id. Nobody sees a note of a space they no longer belong
--     to, the owner included.
--   * note_folders: folders of one person in one space, one level of nesting
--     (a folder under a top folder), a position and a colour of the map
--     palette (never a hex). notes.folder_id puts a note in one.
--   * note_shares: a note OR a folder shared with a member, a group of the
--     company or the whole company, as viewer or editor, optionally allowed to
--     share further. Written only through note_share_set / note_share_remove.
--   * The effective right to a note (note_roles_of) = the highest of the
--     note's own shares and its folder's (the folder, its parent, the folder's
--     owner as editor). Exceptions per note: notes.folder_private ("private in
--     this folder") drops what the folder gives, and a share of the note to one
--     person decides for that person (it may give less than the folder).
--   * RLS: the owner everything; an editor reads and writes the text, never
--     deletes, pins or moves the note out of its folder (notes_guard); a viewer
--     reads. Sharing further: the owner and whoever has can_reshare.
--   * Leaving or being removed from a company ends the access at once (every
--     rule goes through the membership). The person's shared notes and
--     folders stay with the company: their owner becomes the space's owner,
--     who hears it in the bell (account_notifications 'notes_transferred').
--   * note_dismissals: "Remove from mine" for a note someone shared: gone from
--     the lists, search and Grady, never from the owner or the others.
--   * note_versions: who saved what and when (a version per person and ten
--     minutes of work, the 50 newest kept); a version comes back through a
--     normal save. Groundwork for live editing (28.4).
--   * Sharing tells the people in the bell (account_notifications
--     'note_shared'), never by e-mail.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- notes.space_id, folder_id, folder_private
-- -----------------------------------------------------------------------------

alter table public.notes add column space_id uuid references auth.users (id) on delete cascade;
update public.notes set space_id = user_id where space_id is null;
alter table public.notes alter column space_id set not null;

alter table public.notes add column folder_private boolean not null default false;

create index notes_space_list_idx on public.notes (space_id, user_id, updated_at desc)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Folders
-- -----------------------------------------------------------------------------

create table public.note_folders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.note_folders (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  position integer not null default 0 check (position between 0 and 100000),
  -- A colour of the notes' palette (BRANCH_COLORS), never a hex.
  color text not null default 'violet'
    check (color in ('violet', 'teal', 'gold', 'green', 'orange', 'pink')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.note_folders is
  'Folders of notes: one person''s in one space, one level of nesting. Shared through note_shares.';

create index note_folders_space_idx on public.note_folders (space_id, user_id, position);
create index note_folders_parent_idx on public.note_folders (parent_id) where parent_id is not null;

alter table public.notes
  add column folder_id uuid references public.note_folders (id) on delete set null;
create index notes_folder_idx on public.notes (folder_id) where folder_id is not null;

-- -----------------------------------------------------------------------------
-- Shares
-- -----------------------------------------------------------------------------

create table public.note_shares (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  folder_id uuid references public.note_folders (id) on delete cascade,
  target_kind text not null check (target_kind in ('member', 'group', 'space')),
  target_user_id uuid references auth.users (id) on delete cascade,
  group_id uuid references public.worker_groups (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  can_reshare boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_shares_one_item check (num_nonnulls(note_id, folder_id) = 1),
  constraint note_shares_target_shape check (
    (target_kind = 'member' and target_user_id is not null and group_id is null)
    or (target_kind = 'group' and group_id is not null and target_user_id is null)
    or (target_kind = 'space' and target_user_id is null and group_id is null)
  )
);
comment on table public.note_shares is
  'Who a note or a folder is shared with (a member, a group, the whole company) and how. Written only by note_share_set / note_share_remove.';

create unique index note_shares_target_unique on public.note_shares (
  coalesce(note_id, folder_id),
  target_kind,
  coalesce(target_user_id, group_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index note_shares_note_idx on public.note_shares (note_id) where note_id is not null;
create index note_shares_folder_idx on public.note_shares (folder_id) where folder_id is not null;
create index note_shares_space_idx on public.note_shares (space_id, target_kind);

-- -----------------------------------------------------------------------------
-- "Remove from mine"
-- -----------------------------------------------------------------------------

create table public.note_dismissals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
create index note_dismissals_note_idx on public.note_dismissals (note_id);

-- -----------------------------------------------------------------------------
-- Versions
-- -----------------------------------------------------------------------------

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  saved_by uuid references auth.users (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'mindmap')),
  title text not null default '',
  content jsonb not null,
  content_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.note_versions is
  'Saved states of a note: one per person and ten minutes of work, the 50 newest. Written only by the notes_keep_version trigger.';
create index note_versions_note_idx on public.note_versions (note_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Who is who
-- -----------------------------------------------------------------------------

-- Whether an account belongs to a space now: its own, or a company it
-- actively works for. Internal (any account), never for clients.
create or replace function public.space_member_of(_space uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    _space is not null and _user is not null and (
      _space = _user
      or exists (
        select 1 from public.memberships m
        where m.user_id = _user and m.space_id = _space
          and m.role = 'worker' and m.status = 'active'
      )
    ),
    false
  );
$$;
revoke execute on function public.space_member_of(uuid, uuid) from public, anon, authenticated;

-- A person's name in a space: the worker record's, otherwise the profile's.
create or replace function public.space_person_name(_space uuid, _user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(w.name), '') from public.workers w
     where w.owner_id = _space and w.user_id = _user
     order by (w.status = 'active') desc, w.created_at desc limit 1),
    (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = _user),
    ''
  );
$$;
revoke execute on function public.space_person_name(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Effective rights. *_of(user) are internal; the my_* wrappers are what the
-- policies and the app call for the signed-in account.
-- -----------------------------------------------------------------------------

-- Folders of other people the account reaches: through the folder's own
-- shares or its parent's. The highest of them counts.
create or replace function public.note_folder_roles_of(_user uuid, _only uuid default null)
returns table (folder_id uuid, role text, can_reshare boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with spaces as (
    select _user as id
    union
    select m.space_id from public.memberships m
    where m.user_id = _user and m.role = 'worker' and m.status = 'active'
  ),
  my_groups as (
    select gm.group_id
    from public.memberships m
    join public.worker_group_members gm on gm.worker_id = m.worker_id
    where m.user_id = _user and m.role = 'worker' and m.status = 'active'
  ),
  matching as (
    select s.folder_id, s.role, s.can_reshare
    from public.note_shares s
    where s.folder_id is not null
      and s.space_id in (select id from spaces)
      and (
        (s.target_kind = 'member' and s.target_user_id = _user)
        or (s.target_kind = 'group' and s.group_id in (select group_id from my_groups))
        or s.target_kind = 'space'
      )
  )
  select f.id,
    case when bool_or(m.role = 'editor') then 'editor' else 'viewer' end,
    bool_or(m.can_reshare)
  from public.note_folders f
  join matching m on m.folder_id = f.id or m.folder_id = f.parent_id
  where f.space_id in (select id from spaces)
    and f.user_id <> _user
    and (_only is null or f.id = _only)
  group by f.id;
$$;
revoke execute on function public.note_folder_roles_of(uuid, uuid) from public, anon, authenticated;

-- Notes of other people the account reaches, with the role and whether it
-- may share further. A share of the note to the person decides alone;
-- otherwise the highest of the note's shares and its folder's (unless the
-- note is private in its folder). Notes in the trash reach nobody but the owner.
create or replace function public.note_roles_of(_user uuid, _only uuid default null)
returns table (note_id uuid, role text, can_reshare boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with spaces as (
    select _user as id
    union
    select m.space_id from public.memberships m
    where m.user_id = _user and m.role = 'worker' and m.status = 'active'
  ),
  my_groups as (
    select gm.group_id
    from public.memberships m
    join public.worker_group_members gm on gm.worker_id = m.worker_id
    where m.user_id = _user and m.role = 'worker' and m.status = 'active'
  ),
  matching as (
    select s.note_id, s.folder_id, s.target_kind, s.role, s.can_reshare
    from public.note_shares s
    where s.space_id in (select id from spaces)
      and (
        (s.target_kind = 'member' and s.target_user_id = _user)
        or (s.target_kind = 'group' and s.group_id in (select group_id from my_groups))
        or s.target_kind = 'space'
      )
  ),
  folder_role as (
    select f.id as folder_id, m.role, m.can_reshare
    from public.note_folders f
    join matching m on m.folder_id is not null and (m.folder_id = f.id or m.folder_id = f.parent_id)
    where f.space_id in (select id from spaces)
    union all
    select f.id, 'editor', true
    from public.note_folders f
    where f.user_id = _user and f.space_id in (select id from spaces)
  ),
  live as (
    select n.id, n.folder_id, n.folder_private
    from public.notes n
    where n.space_id in (select id from spaces)
      and n.user_id <> _user
      and n.deleted_at is null
      and (_only is null or n.id = _only)
  ),
  candidates as (
    select l.id, m.target_kind = 'member' as personal, m.role, m.can_reshare
    from live l join matching m on m.note_id = l.id
    union all
    select l.id, false, r.role, r.can_reshare
    from live l join folder_role r on r.folder_id = l.folder_id
    where not l.folder_private
  )
  select c.id,
    case
      when bool_or(c.personal) then
        case when bool_or(c.personal and c.role = 'editor') then 'editor' else 'viewer' end
      when bool_or(c.role = 'editor') then 'editor'
      else 'viewer'
    end,
    case
      when bool_or(c.personal) then bool_or(c.personal and c.can_reshare)
      else bool_or(c.can_reshare)
    end
  from candidates c
  group by c.id;
$$;
revoke execute on function public.note_roles_of(uuid, uuid) from public, anon, authenticated;

create or replace function public.note_my_roles()
returns table (note_id uuid, role text, can_reshare boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.note_id, r.role, r.can_reshare from public.note_roles_of(auth.uid(), null) r
  where auth.uid() is not null;
$$;
revoke execute on function public.note_my_roles() from public, anon;
grant execute on function public.note_my_roles() to authenticated;

create or replace function public.note_my_folder_roles()
returns table (folder_id uuid, role text, can_reshare boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.folder_id, r.role, r.can_reshare from public.note_folder_roles_of(auth.uid(), null) r
  where auth.uid() is not null;
$$;
revoke execute on function public.note_my_folder_roles() from public, anon;
grant execute on function public.note_my_folder_roles() to authenticated;

-- The signed-in account's role to one note: owner, editor, viewer or null.
create or replace function public.note_role(_note uuid)
returns table (role text, can_reshare boolean, dismissed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when n.user_id = auth.uid() then 'owner' else r.role end,
    case when n.user_id = auth.uid() then true else coalesce(r.can_reshare, false) end,
    exists (select 1 from public.note_dismissals d where d.note_id = n.id and d.user_id = auth.uid())
  from public.notes n
  left join public.note_roles_of(auth.uid(), _note) r on r.note_id = n.id
  where n.id = _note
    and auth.uid() is not null
    and public.is_space_member(n.space_id)
    and (n.user_id = auth.uid() or r.note_id is not null);
$$;
revoke execute on function public.note_role(uuid) from public, anon;
grant execute on function public.note_role(uuid) to authenticated;

-- Whether the signed-in account may put a note into the folder: it owns the
-- folder or edits it through a share.
create or replace function public.note_folder_writable(_folder uuid, _space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.note_folders f
    where f.id = _folder
      and f.space_id = _space
      and public.is_space_member(f.space_id)
      and (
        f.user_id = auth.uid()
        or exists (
          select 1 from public.note_folder_roles_of(auth.uid(), _folder) r where r.role = 'editor'
        )
      )
  ), false);
$$;
revoke execute on function public.note_folder_writable(uuid, uuid) from public, anon;
grant execute on function public.note_folder_writable(uuid, uuid) to authenticated;

create or replace function public.note_folder_exists(_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.note_folders f where f.id = _folder);
$$;
revoke execute on function public.note_folder_exists(uuid) from public, anon;
-- notes_guard runs as the client: it may ask whether a folder still exists, nothing more.
grant execute on function public.note_folder_exists(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Guards. The handover of a departing person's notes (below) sets
-- gradus.notes_transfer for its own transaction; nothing a client sends can.
-- -----------------------------------------------------------------------------

create or replace function public.notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _transfer boolean := coalesce(current_setting('gradus.notes_transfer', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
    -- The server and older clients name no space: the owner's own.
    new.space_id := coalesce(new.space_id, new.user_id);
    if new.folder_id is not null and auth.uid() is not null
      and not public.note_folder_writable(new.folder_id, new.space_id) then
      raise exception 'note_folder_denied' using errcode = 'P0001';
    end if;
    return new;
  end if;

  new.space_id := old.space_id;
  new.created_at := old.created_at;
  if _transfer then
    new.updated_at := old.updated_at;
    return new;
  end if;

  new.user_id := old.user_id;
  if new.title is distinct from old.title
    or new.content is distinct from old.content
    or new.content_text is distinct from old.content_text then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;

  if auth.uid() is not null and auth.uid() is distinct from old.user_id then
    -- Someone it is shared with: the text only.
    new.pinned := old.pinned;
    new.deleted_at := old.deleted_at;
    new.folder_private := old.folder_private;
    if new.folder_id is distinct from old.folder_id
      and not (new.folder_id is null and not public.note_folder_exists(old.folder_id)) then
      raise exception 'note_owner_only' using errcode = 'P0001';
    end if;
  elsif new.folder_id is distinct from old.folder_id and new.folder_id is not null
    and auth.uid() is not null
    and not public.note_folder_writable(new.folder_id, new.space_id) then
    raise exception 'note_folder_denied' using errcode = 'P0001';
  end if;

  if new.deleted_at is not null then
    new.deleted_at := coalesce(old.deleted_at, now());
  end if;
  return new;
end;
$$;

create or replace function public.note_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _transfer boolean := coalesce(current_setting('gradus.notes_transfer', true), '') = 'on';
  _parent public.note_folders%rowtype;
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.space_id := coalesce(new.space_id, new.user_id);
    new.created_at := now();
    new.updated_at := now();
    if auth.uid() is not null and (
      select count(*) from public.note_folders f
      where f.space_id = new.space_id and f.user_id = new.user_id
    ) >= 200 then
      raise exception 'note_folder_limit' using errcode = 'P0001';
    end if;
  else
    if not _transfer then
      new.user_id := old.user_id;
    end if;
    new.space_id := old.space_id;
    new.created_at := old.created_at;
    new.updated_at := now();
    if _transfer then
      return new;
    end if;
  end if;

  if new.parent_id is not null then
    select * into _parent from public.note_folders f where f.id = new.parent_id;
    if not found
      or new.parent_id = new.id
      or _parent.space_id <> new.space_id
      or _parent.user_id <> new.user_id
      or _parent.parent_id is not null
      or exists (select 1 from public.note_folders c where c.parent_id = new.id) then
      raise exception 'note_folder_parent' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.note_folders_guard() from public, anon, authenticated;

create trigger note_folders_guard before insert or update on public.note_folders
  for each row execute function public.note_folders_guard();

-- Read-only spaces keep their notes, folders and shares unchanged; the
-- handover of a departing person's notes still goes through.
create or replace function public.notes_enforce_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('gradus.notes_transfer', true), '') = 'on' or auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.workspace_read_only(new.space_id) then
    raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and public.workspace_read_only(old.space_id) then
    raise exception 'read_only' using errcode = 'P0001', hint = 'The trial has ended.';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.notes_enforce_writable() from public, anon, authenticated;

drop trigger notes_writable on public.notes;
create trigger notes_writable before insert or update or delete on public.notes
  for each row execute function public.notes_enforce_writable();
create trigger note_folders_writable before insert or update or delete on public.note_folders
  for each row execute function public.notes_enforce_writable();
create trigger note_shares_writable before insert or update or delete on public.note_shares
  for each row execute function public.notes_enforce_writable();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

drop policy notes_select_own on public.notes;
drop policy notes_insert_own on public.notes;
drop policy notes_update_own on public.notes;
drop policy notes_delete_own on public.notes;

create policy notes_select on public.notes for select to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      user_id = (select auth.uid())
      or id in (select r.note_id from public.note_my_roles() r)
    )
  );
create policy notes_insert on public.notes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
create policy notes_update on public.notes for update to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      user_id = (select auth.uid())
      or id in (select r.note_id from public.note_my_roles() r where r.role = 'editor')
    )
  )
  with check (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      user_id = (select auth.uid())
      or id in (select r.note_id from public.note_my_roles() r where r.role = 'editor')
    )
  );
create policy notes_delete on public.notes for delete to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );

grant insert (space_id, folder_id, folder_private) on public.notes to authenticated;
grant update (folder_id, folder_private) on public.notes to authenticated;

alter table public.note_folders enable row level security;
create policy note_folders_select on public.note_folders for select to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      user_id = (select auth.uid())
      or id in (select r.folder_id from public.note_my_folder_roles() r)
    )
  );
create policy note_folders_insert on public.note_folders for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
create policy note_folders_update on public.note_folders for update to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  )
  with check (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
create policy note_folders_delete on public.note_folders for delete to authenticated
  using (
    user_id = (select auth.uid())
    and space_id = any ((select public.member_spaces())::uuid[])
  );
revoke all on public.note_folders from anon;
revoke insert, update on public.note_folders from authenticated;
grant select, delete on public.note_folders to authenticated;
grant insert (id, space_id, parent_id, name, position, color) on public.note_folders to authenticated;
grant update (parent_id, name, position, color) on public.note_folders to authenticated;

-- Shares are seen by whoever sees the note or the folder; nobody writes them
-- directly.
alter table public.note_shares enable row level security;
create policy note_shares_select on public.note_shares for select to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and (
      (note_id is not null and exists (select 1 from public.notes n where n.id = note_id))
      or (folder_id is not null and exists (select 1 from public.note_folders f where f.id = folder_id))
    )
  );
revoke all on public.note_shares from anon, authenticated;
grant select on public.note_shares to authenticated;

alter table public.note_dismissals enable row level security;
create policy note_dismissals_select on public.note_dismissals for select to authenticated
  using (user_id = (select auth.uid()));
-- Only a note someone else owns and the account reaches.
create policy note_dismissals_insert on public.note_dismissals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id <> (select auth.uid())
    )
  );
create policy note_dismissals_delete on public.note_dismissals for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.note_dismissals from anon, authenticated;
grant select, delete on public.note_dismissals to authenticated;
grant insert (note_id) on public.note_dismissals to authenticated;

alter table public.note_versions enable row level security;
create policy note_versions_select on public.note_versions for select to authenticated
  using (
    space_id = any ((select public.member_spaces())::uuid[])
    and exists (select 1 from public.notes n where n.id = note_id)
  );
revoke all on public.note_versions from anon, authenticated;
grant select on public.note_versions to authenticated;

-- Links: the caller's own task, milestone or deal, and a note the caller reaches.
drop policy note_links_insert_own on public.note_links;
create policy note_links_insert_own on public.note_links for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.notes n where n.id = note_id)
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

-- Mentions: what the notes of a space mention is listed from that space's
-- records, and seen by whoever reads the note.
drop policy note_mentions_select_own on public.note_mentions;
create policy note_mentions_select on public.note_mentions for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.notes n where n.id = note_id)
  );

create or replace function public.notes_sync_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _types text[];
  _ids uuid[];
begin
  begin
    if position('"mention"' in new.content::text) = 0 then
      delete from public.note_mentions where note_id = new.id;
      return null;
    end if;

    select
      coalesce(array_agg(ref.target_type), '{}'),
      coalesce(array_agg(ref.target_id), '{}')
    into _types, _ids
    from (
      select distinct raw.target_type, raw.target_id::uuid as target_id
      from (
        select
          node -> 'attrs' ->> 'type' as target_type,
          node -> 'attrs' ->> 'id' as target_id
        from jsonb_path_query(new.content, 'strict $.**') as node
        where jsonb_typeof(node) = 'object'
          and node ->> 'type' = 'mention'
        limit 1000
      ) raw
      where raw.target_type in ('contact', 'deal', 'event', 'worker')
        and raw.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      limit 200
    ) ref;

    delete from public.note_mentions m
    where m.note_id = new.id
      and not exists (
        select 1 from unnest(_types, _ids) as r (target_type, target_id)
        where r.target_type = m.target_type and r.target_id = m.target_id
      );

    -- Records of the note's space only.
    insert into public.note_mentions (user_id, note_id, target_type, target_id)
    select new.user_id, new.id, r.target_type, r.target_id
    from unnest(_types, _ids) as r (target_type, target_id)
    where case r.target_type
      when 'contact' then exists (
        select 1 from public.contacts c where c.id = r.target_id and c.user_id = new.space_id)
      when 'deal' then exists (
        select 1 from public.deals d where d.id = r.target_id and d.user_id = new.space_id)
      when 'event' then exists (
        select 1 from public.calendar_events e where e.id = r.target_id and e.user_id = new.space_id)
      when 'worker' then exists (
        select 1 from public.workers w where w.id = r.target_id and w.owner_id = new.space_id)
      else false
    end
    on conflict (note_id, target_type, target_id) do nothing;
  exception when others then
    raise warning 'notes_sync_mentions(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- The mentioned records of a note that still exist, for a reader of the note:
-- a chip whose record the reader can not open shows as a hidden record, one
-- that is gone as gone. Only kinds and ids, never names.
create or replace function public.note_mention_states(_note uuid)
returns table (target_type text, target_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select m.target_type, m.target_id
  from public.note_mentions m
  join public.notes n on n.id = m.note_id
  where m.note_id = _note
    and exists (select 1 from public.note_role(_note))
    and case m.target_type
      when 'contact' then exists (
        select 1 from public.contacts c where c.id = m.target_id and c.user_id = n.space_id)
      when 'deal' then exists (
        select 1 from public.deals d where d.id = m.target_id and d.user_id = n.space_id)
      when 'event' then exists (
        select 1 from public.calendar_events e where e.id = m.target_id and e.user_id = n.space_id)
      when 'worker' then exists (
        select 1 from public.workers w where w.id = m.target_id and w.owner_id = n.space_id)
      else false
    end
  limit 200;
$$;
revoke execute on function public.note_mention_states(uuid) from public, anon;
grant execute on function public.note_mention_states(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Versions: kept by a trigger on every change of the text
-- -----------------------------------------------------------------------------

create or replace function public.notes_keep_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _by uuid := coalesce(auth.uid(), new.user_id);
  _last public.note_versions%rowtype;
begin
  begin
    if tg_op = 'INSERT' and new.content_text = '' then
      return null;
    end if;
    select * into _last from public.note_versions v
    where v.note_id = new.id order by v.created_at desc limit 1;
    -- The text from before versions existed is the first one.
    if tg_op = 'UPDATE' and _last.id is null and old.content_text <> '' then
      insert into public.note_versions
        (note_id, space_id, saved_by, kind, title, content, content_text, created_at, updated_at)
      values
        (old.id, old.space_id, old.user_id, old.kind, old.title, old.content, old.content_text,
         old.updated_at, old.updated_at)
      returning * into _last;
    end if;
    if _last.id is not null
      and _last.saved_by is not distinct from _by
      and _last.created_at > now() - interval '10 minutes' then
      update public.note_versions
      set kind = new.kind, title = new.title, content = new.content,
          content_text = new.content_text, updated_at = now()
      where id = _last.id;
    else
      insert into public.note_versions
        (note_id, space_id, saved_by, kind, title, content, content_text)
      values (new.id, new.space_id, _by, new.kind, new.title, new.content, new.content_text);
      delete from public.note_versions v
      where v.note_id = new.id
        and v.id not in (
          select k.id from public.note_versions k
          where k.note_id = new.id order by k.created_at desc limit 50
        );
    end if;
  exception when others then
    raise warning 'notes_keep_version(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.notes_keep_version() from public, anon, authenticated;

create trigger notes_keep_version_insert after insert on public.notes
  for each row execute function public.notes_keep_version();
create trigger notes_keep_version_update after update of title, content, content_text, kind on public.notes
  for each row when (old.content is distinct from new.content or old.title is distinct from new.title)
  execute function public.notes_keep_version();

-- The versions of a note for its readers: who saved, when, and the start of the text.
create or replace function public.note_versions_list(_note uuid, _limit integer default 50)
returns table (
  id uuid,
  saved_by uuid,
  saved_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  kind text,
  title text,
  excerpt text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.saved_by, public.space_person_name(v.space_id, v.saved_by),
    v.created_at, v.updated_at, v.kind, v.title, left(v.content_text, 400)
  from public.note_versions v
  where v.note_id = _note
    and exists (select 1 from public.note_role(_note))
  order by v.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 50);
$$;
revoke execute on function public.note_versions_list(uuid, integer) from public, anon;
grant execute on function public.note_versions_list(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Lists for the screen
-- -----------------------------------------------------------------------------

-- The notes of a space the account reaches (its own and those shared with it,
-- without the ones it removed from its lists), with its role, the owner and
-- whether anyone else reaches the note. Newest first, at most 500.
create or replace function public.notes_list(_space uuid)
returns table (
  id uuid,
  kind text,
  title text,
  preview text,
  pinned boolean,
  created_at timestamptz,
  updated_at timestamptz,
  is_demo boolean,
  owner_id uuid,
  owner_name text,
  folder_id uuid,
  folder_private boolean,
  role text,
  can_reshare boolean,
  shared boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with roles as (
    select r.note_id, r.role, r.can_reshare from public.note_roles_of(auth.uid(), null) r
  )
  select
    n.id, n.kind, n.title, n.preview,
    n.pinned and n.user_id = auth.uid(),
    n.created_at, n.updated_at, n.is_demo,
    n.user_id,
    case when n.user_id = auth.uid() then null else public.space_person_name(n.space_id, n.user_id) end,
    n.folder_id, n.folder_private,
    coalesce(r.role, 'owner'),
    coalesce(r.can_reshare, true),
    exists (select 1 from public.note_shares s where s.note_id = n.id)
      or (
        n.folder_id is not null and not n.folder_private and exists (
          select 1 from public.note_folders f
          where f.id = n.folder_id and (
            f.user_id <> n.user_id
            or exists (select 1 from public.note_shares s where s.folder_id in (f.id, f.parent_id))
          )
        )
      )
  from public.notes n
  left join roles r on r.note_id = n.id
  where n.space_id = _space
    and public.is_space_member(_space)
    and n.deleted_at is null
    and (n.user_id = auth.uid() or r.note_id is not null)
    and not exists (
      select 1 from public.note_dismissals d where d.note_id = n.id and d.user_id = auth.uid()
    )
  order by (n.pinned and n.user_id = auth.uid()) desc, n.updated_at desc
  limit 500;
$$;
revoke execute on function public.notes_list(uuid) from public, anon;
grant execute on function public.notes_list(uuid) to authenticated;

-- The folders of a space the account sees: its own and those shared with it.
create or replace function public.note_folders_list(_space uuid)
returns table (
  id uuid,
  parent_id uuid,
  name text,
  color text,
  "position" integer,
  owner_id uuid,
  owner_name text,
  role text,
  can_reshare boolean,
  shared boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with roles as (
    select r.folder_id, r.role, r.can_reshare from public.note_folder_roles_of(auth.uid(), null) r
  )
  select
    f.id, f.parent_id, f.name, f.color, f.position, f.user_id,
    case when f.user_id = auth.uid() then null else public.space_person_name(f.space_id, f.user_id) end,
    coalesce(r.role, 'owner'),
    coalesce(r.can_reshare, true),
    exists (select 1 from public.note_shares s where s.folder_id in (f.id, f.parent_id))
  from public.note_folders f
  left join roles r on r.folder_id = f.id
  where f.space_id = _space
    and public.is_space_member(_space)
    and (f.user_id = auth.uid() or r.folder_id is not null)
  order by f.position, lower(f.name), f.id
  limit 400;
$$;
revoke execute on function public.note_folders_list(uuid) from public, anon;
grant execute on function public.note_folders_list(uuid) to authenticated;

-- The groups of a space for the share dialog (every member may share with any of them).
create or replace function public.note_share_groups(_space uuid)
returns table (id uuid, name text, color text, member_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.color,
    (select count(*) from public.worker_group_members gm
     join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
     where gm.group_id = g.id)::integer
  from public.worker_groups g
  where g.owner_id = _space and public.is_space_member(_space)
  order by g.position, lower(g.name)
  limit 200;
$$;
revoke execute on function public.note_share_groups(uuid) from public, anon;
grant execute on function public.note_share_groups(uuid) to authenticated;

-- Who has access to a note or a folder and from where, for its readers:
--   entry 'owner'        the owner
--   entry 'share'        a share of the item itself (source 'direct') or of
--                        its folder / parent folder (source 'folder')
--   entry 'folder_owner' the owner of the folder a note is in (an editor)
-- Shares to people who no longer work there are left out.
create or replace function public.note_access_list(_note uuid default null, _folder uuid default null)
returns table (
  entry text,
  source text,
  share_id uuid,
  target_kind text,
  user_id uuid,
  group_id uuid,
  name text,
  avatar_url text,
  member_count integer,
  role text,
  can_reshare boolean,
  created_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _space uuid;
  _owner uuid;
  _folder_id uuid;
  _private boolean := false;
  _folder_owner uuid;
  _parent uuid;
begin
  if _uid is null or num_nonnulls(_note, _folder) <> 1 then
    return;
  end if;
  if _note is not null then
    select n.space_id, n.user_id, n.folder_id, n.folder_private
    into _space, _owner, _folder_id, _private
    from public.notes n where n.id = _note;
    if _space is null or not exists (select 1 from public.note_role(_note)) then
      return;
    end if;
  else
    select f.space_id, f.user_id into _space, _owner from public.note_folders f where f.id = _folder;
    if _space is null or not public.is_space_member(_space)
      or (_owner <> _uid and not exists (select 1 from public.note_folder_roles_of(_uid, _folder))) then
      return;
    end if;
    _folder_id := _folder;
  end if;
  if _folder_id is not null then
    select f.user_id, f.parent_id into _folder_owner, _parent from public.note_folders f where f.id = _folder_id;
  end if;

  return query
  with people as (
    select a.user_id, a.name, a.avatar_url from public.active_members(_space) a
  )
  select 'owner', 'direct', null::uuid, 'member', _owner, null::uuid,
    coalesce((select p.name from people p where p.user_id = _owner), public.space_person_name(_space, _owner)),
    (select p.avatar_url from people p where p.user_id = _owner),
    null::integer, 'owner', true, null::uuid
  union all
  select 'folder_owner', 'folder', null::uuid, 'member', _folder_owner, null::uuid,
    p.name, p.avatar_url, null::integer, 'editor', true, null::uuid
  from people p
  where _note is not null and _folder_owner is not null and _folder_owner <> _owner
    and not _private and p.user_id = _folder_owner
  union all
  select 'share',
    case when s.note_id is not null or s.folder_id = _folder then 'direct' else 'folder' end,
    s.id, s.target_kind, s.target_user_id, s.group_id,
    case s.target_kind
      when 'member' then (select p.name from people p where p.user_id = s.target_user_id)
      when 'group' then (select g.name from public.worker_groups g where g.id = s.group_id)
      else null
    end,
    case when s.target_kind = 'member'
      then (select p.avatar_url from people p where p.user_id = s.target_user_id) end,
    case when s.target_kind = 'group' then (
      select count(*) from public.worker_group_members gm
      join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
      where gm.group_id = s.group_id)::integer end,
    s.role, s.can_reshare, s.created_by
  from public.note_shares s
  where (
      (_note is not null and s.note_id = _note)
      or (s.folder_id is not null and s.folder_id in (_folder_id, _parent)
          and (_note is null or not _private))
    )
    and (s.target_kind <> 'member' or exists (select 1 from people p where p.user_id = s.target_user_id));
end;
$$;
revoke execute on function public.note_access_list(uuid, uuid) from public, anon;
grant execute on function public.note_access_list(uuid, uuid) to authenticated;

-- The people who reach a note or a folder now (owner first), for the
-- avatars in its header. Members of the space only, at most 50.
create or replace function public.note_people(_note uuid default null, _folder uuid default null)
returns table (user_id uuid, name text, avatar_url text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _space uuid;
  _owner uuid;
begin
  if _uid is null or num_nonnulls(_note, _folder) <> 1 then
    return;
  end if;
  if _note is not null then
    select n.space_id, n.user_id into _space, _owner from public.notes n where n.id = _note;
    if _space is null or not exists (select 1 from public.note_role(_note)) then
      return;
    end if;
  else
    select f.space_id, f.user_id into _space, _owner from public.note_folders f where f.id = _folder;
    if _space is null or not public.is_space_member(_space)
      or (_owner <> _uid and not exists (select 1 from public.note_folder_roles_of(_uid, _folder))) then
      return;
    end if;
  end if;
  return query
  select x.user_id, x.name, x.avatar_url, x.role from (
    select a.user_id, a.name, a.avatar_url,
      case
        when a.user_id = _owner then 'owner'
        when _note is not null then (select r.role from public.note_roles_of(a.user_id, _note) r)
        else (select r.role from public.note_folder_roles_of(a.user_id, _folder) r)
      end as role
    from public.active_members(_space) a
  ) x
  where x.role is not null
  order by (x.role = 'owner') desc, lower(x.name)
  limit 50;
end;
$$;
revoke execute on function public.note_people(uuid, uuid) from public, anon;
grant execute on function public.note_people(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Sharing
-- -----------------------------------------------------------------------------

alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check
  check (kind in (
    'invite_accepted', 'invite_declined', 'worker_left', 'invite_requested',
    'note_shared', 'notes_transferred'
  ));
alter table public.account_notifications
  add column space_id uuid references auth.users (id) on delete cascade,
  add column note_id uuid references public.notes (id) on delete cascade,
  add column folder_id uuid references public.note_folders (id) on delete cascade,
  add column actor_id uuid references auth.users (id) on delete set null,
  add column item_count integer check (item_count is null or item_count >= 0);

-- Shares a note or a folder with a member, a group or the whole company, or
-- changes an existing share of the same target. The owner may do anything;
-- someone with can_reshare may share up to their own role and change only
-- the shares they made. The people who newly get access hear it in the bell.
-- Errors: note_share_denied, note_share_target, not_found, read_only.
create or replace function public.note_share_set(
  _note uuid,
  _folder uuid,
  _target_kind text,
  _target uuid,
  _role text,
  _can_reshare boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _space uuid;
  _owner uuid;
  _my_role text;
  _my_reshare boolean;
  _existing public.note_shares%rowtype;
  _id uuid;
  _recipients uuid[];
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if num_nonnulls(_note, _folder) <> 1
    or _target_kind not in ('member', 'group', 'space')
    or _role not in ('viewer', 'editor') then
    raise exception 'note_share_target' using errcode = 'P0001';
  end if;

  if _note is not null then
    select n.space_id, n.user_id into _space, _owner
    from public.notes n where n.id = _note and n.deleted_at is null;
    if _space is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select r.role, r.can_reshare into _my_role, _my_reshare from public.note_role(_note) r;
  else
    select f.space_id, f.user_id into _space, _owner from public.note_folders f where f.id = _folder;
    if _space is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if _owner = _uid then
      _my_role := 'owner';
      _my_reshare := true;
    else
      select r.role, r.can_reshare into _my_role, _my_reshare
      from public.note_folder_roles_of(_uid, _folder) r;
    end if;
  end if;

  if not public.is_space_member(_space) or _my_role is null
    or (_my_role <> 'owner' and not coalesce(_my_reshare, false))
    or (_my_role = 'viewer' and _role = 'editor') then
    raise exception 'note_share_denied' using errcode = '42501';
  end if;

  -- Only people and groups of this company, never the owner or oneself.
  if _target_kind = 'member' then
    if _target is null or _target = _owner or _target = _uid
      or not public.space_member_of(_space, _target) then
      raise exception 'note_share_target' using errcode = 'P0001';
    end if;
  elsif _target_kind = 'group' then
    if _target is null or not exists (
      select 1 from public.worker_groups g where g.id = _target and g.owner_id = _space
    ) then
      raise exception 'note_share_target' using errcode = 'P0001';
    end if;
  else
    _target := null;
  end if;

  select * into _existing from public.note_shares s
  where coalesce(s.note_id, s.folder_id) = coalesce(_note, _folder)
    and s.target_kind = _target_kind
    and coalesce(s.target_user_id, s.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(_target, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if _existing.id is not null then
    if _my_role <> 'owner' and _existing.created_by is distinct from _uid then
      raise exception 'note_share_denied' using errcode = '42501';
    end if;
    update public.note_shares
    set role = _role,
        can_reshare = coalesce(_can_reshare, false),
        updated_at = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into public.note_shares
    (space_id, note_id, folder_id, target_kind, target_user_id, group_id, role, can_reshare, created_by)
  values (
    _space, _note, _folder, _target_kind,
    case when _target_kind = 'member' then _target end,
    case when _target_kind = 'group' then _target end,
    _role, coalesce(_can_reshare, false), _uid
  )
  returning id into _id;

  -- Who hears it: the person, the group's active members, or everybody of
  -- the company; never the one sharing nor the owner.
  select coalesce(array_agg(distinct x.u), '{}') into _recipients from (
    select _target as u where _target_kind = 'member'
    union all
    select w.user_id from public.worker_group_members gm
    join public.workers w on w.id = gm.worker_id and w.status = 'active' and w.user_id is not null
    where _target_kind = 'group' and gm.group_id = _target
    union all
    select a.user_id from public.active_members(_space) a where _target_kind = 'space'
  ) x
  where x.u is not null and x.u <> _uid and x.u <> _owner
    and public.space_member_of(_space, x.u);

  if _note is not null then
    delete from public.note_dismissals d where d.note_id = _note and d.user_id = any (_recipients);
  end if;

  insert into public.account_notifications (user_id, kind, space_id, note_id, folder_id, actor_id)
  select r, 'note_shared', _space, _note, _folder, _uid
  from unnest(_recipients[1:500]) as r;

  return _id;
end;
$$;
revoke execute on function public.note_share_set(uuid, uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.note_share_set(uuid, uuid, text, uuid, text, boolean) to authenticated;

-- Removes a share: the owner of the item any, others only the ones they made.
create or replace function public.note_share_remove(_share uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _row public.note_shares%rowtype;
  _owner uuid;
begin
  if _uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into _row from public.note_shares s where s.id = _share for update;
  if _row.id is null or not public.is_space_member(_row.space_id) then
    return false;
  end if;
  if _row.note_id is not null then
    select n.user_id into _owner from public.notes n where n.id = _row.note_id;
  else
    select f.user_id into _owner from public.note_folders f where f.id = _row.folder_id;
  end if;
  if _owner is distinct from _uid and _row.created_by is distinct from _uid then
    raise exception 'note_share_denied' using errcode = '42501';
  end if;
  delete from public.note_shares where id = _share;
  return true;
end;
$$;
revoke execute on function public.note_share_remove(uuid) from public, anon;
grant execute on function public.note_share_remove(uuid) to authenticated;

-- The notes and folders the bell's notifications point to, for their
-- recipient: who did it and the title, only while the account still reaches it.
create or replace function public.note_notification_labels(_ids uuid[])
returns table (id uuid, actor_name text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
    case when a.actor_id is null then null else public.space_person_name(a.space_id, a.actor_id) end,
    case
      when a.note_id is not null then (
        select coalesce(nullif(n.title, ''), '') from public.notes n
        where n.id = a.note_id and exists (select 1 from public.note_role(a.note_id)))
      when a.folder_id is not null then (
        select f.name from public.note_folders f
        where f.id = a.folder_id and public.is_space_member(f.space_id)
          and (f.user_id = auth.uid()
               or exists (select 1 from public.note_folder_roles_of(auth.uid(), a.folder_id))))
    end
  from public.account_notifications a
  where a.id = any (_ids[1:50]) and a.user_id = auth.uid();
$$;
revoke execute on function public.note_notification_labels(uuid[]) from public, anon;
grant execute on function public.note_notification_labels(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Leaving a company: access ends with the membership; the person's shared
-- notes and folders stay with the company under its owner.
-- -----------------------------------------------------------------------------

create or replace function public.notes_hand_over(_space uuid, _user uuid, _worker uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _folders uuid[];
  _notes integer := 0;
begin
  if _space is null or _user is null or _space = _user then
    return 0;
  end if;
  perform set_config('gradus.notes_transfer', 'on', true);

  -- A whole top folder with its subfolders goes when any of them is shared.
  select coalesce(array_agg(f.id), '{}') into _folders
  from public.note_folders f
  where f.space_id = _space and f.user_id = _user
    and exists (
      select 1 from public.note_folders t
      join public.note_shares s on s.folder_id = t.id
      where t.space_id = _space and t.user_id = _user
        and (t.id = coalesce(f.parent_id, f.id) or t.parent_id = coalesce(f.parent_id, f.id))
    );

  with moved as (
    update public.notes n
    set user_id = _space,
        folder_id = case
          when n.folder_id is null or n.folder_id = any (_folders) then n.folder_id
          when exists (select 1 from public.note_folders f where f.id = n.folder_id and f.user_id <> _user)
            then n.folder_id
          else null
        end
    where n.space_id = _space and n.user_id = _user
      and (
        exists (select 1 from public.note_shares s where s.note_id = n.id)
        or (
          n.folder_id is not null and not n.folder_private and exists (
            select 1 from public.note_folders f
            where f.id = n.folder_id and (
              f.user_id <> _user
              or exists (select 1 from public.note_shares s where s.folder_id in (f.id, f.parent_id))
            )
          )
        )
      )
    returning 1
  )
  select count(*) into _notes from moved;

  update public.note_folders set user_id = _space where id = any (_folders);

  if _notes > 0 or cardinality(_folders) > 0 then
    insert into public.account_notifications (user_id, kind, worker_id, space_id, actor_id, item_count)
    values (_space, 'notes_transferred', _worker, _space, _user, _notes);
  end if;

  perform set_config('gradus.notes_transfer', '', true);
  return _notes;
end;
$$;
revoke execute on function public.notes_hand_over(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.memberships_notes_hand_over()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'worker' and old.status = 'active' and new.status in ('left', 'removed') then
    perform public.notes_hand_over(new.space_id, new.user_id, new.worker_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.memberships_notes_hand_over() from public, anon, authenticated;

create trigger memberships_notes_hand_over after update of status on public.memberships
  for each row execute function public.memberships_notes_hand_over();

-- -----------------------------------------------------------------------------
-- Search and Grady: the active space, the account's own notes and the ones
-- shared with it (not removed from its lists).
-- -----------------------------------------------------------------------------

drop function public.search_notes(text, integer);
create or replace function public.search_notes(
  _query text,
  _limit integer default 20,
  _space uuid default null
)
returns table (id uuid, title text, rank real, data jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _sp uuid;
  _lim integer := least(greatest(coalesce(_limit, 20), 1), 50);
  _tsq tsquery;
  _word text;
  _words integer := 0;
begin
  if _uid is null then
    return;
  end if;
  _sp := coalesce(_space, public.current_workspace_id());
  if not public.is_space_member(_sp) then
    return;
  end if;
  foreach _word in array regexp_split_to_array(
    public.search_norm(left(coalesce(_query, ''), 100)), '[^a-z0-9]+'
  ) loop
    continue when _word = '';
    _words := _words + 1;
    exit when _words > 8;
    _tsq := case
      when _tsq is null then to_tsquery('simple', _word || ':*')
      else _tsq && to_tsquery('simple', _word || ':*')
    end;
  end loop;
  if _tsq is null then
    return;
  end if;

  return query
  select
    n.id,
    n.title,
    ts_rank(n.search_vector, _tsq)::real as rank,
    jsonb_build_object(
      'preview', n.preview,
      'updatedAt', n.updated_at,
      'pinned', n.pinned and n.user_id = _uid,
      'shared', n.user_id <> _uid
    ) as data
  from public.notes n
  left join public.note_roles_of(_uid, null) r on r.note_id = n.id
  where n.space_id = _sp
    and n.deleted_at is null
    and (n.user_id = _uid or r.note_id is not null)
    and not exists (select 1 from public.note_dismissals d where d.note_id = n.id and d.user_id = _uid)
    and n.search_vector @@ _tsq
  order by rank desc, n.updated_at desc
  limit _lim;
end;
$$;
revoke execute on function public.search_notes(text, integer, uuid) from public, anon;
grant execute on function public.search_notes(text, integer, uuid) to authenticated;

drop function public.jarvis_notes(text, integer);
create or replace function public.jarvis_notes(
  _query text default null,
  _body_chars integer default 12000,
  _space uuid default null
)
returns table (
  id uuid,
  title text,
  updated_at timestamptz,
  pinned boolean,
  recent boolean,
  links jsonb,
  match_rank real,
  body text,
  kind text,
  author text,
  role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _sp uuid;
  _chars integer := least(greatest(coalesce(_body_chars, 12000), 0), 12000);
  _tsq tsquery;
  _word text;
  _words integer := 0;
begin
  if _uid is null then
    return;
  end if;
  _sp := coalesce(_space, public.current_workspace_id());
  if not public.is_space_member(_sp) then
    return;
  end if;
  foreach _word in array regexp_split_to_array(
    public.search_norm(left(coalesce(_query, ''), 2000)), '[^a-z0-9]+'
  ) loop
    continue when char_length(_word) < 3;
    _words := _words + 1;
    exit when _words > 12;
    _tsq := case
      when _tsq is null then to_tsquery('simple', _word || ':*')
      else _tsq || to_tsquery('simple', _word || ':*')
    end;
  end loop;

  return query
  with roles as (
    select r.note_id, r.role from public.note_roles_of(_uid, null) r
  ),
  live as (
    select n.id, n.title, n.updated_at, n.pinned and n.user_id = _uid as pinned, n.content_text,
      n.search_vector, n.kind, n.user_id, n.space_id,
      case when n.user_id = _uid then 'owner' else r.role end as role
    from public.notes n
    left join roles r on r.note_id = n.id
    where n.space_id = _sp
      and n.deleted_at is null
      and (n.user_id = _uid or r.note_id is not null)
      and not exists (select 1 from public.note_dismissals d where d.note_id = n.id and d.user_id = _uid)
  ),
  recent as (
    select l.id from live l order by l.updated_at desc limit 50
  ),
  pinned as (
    select l.id from live l where l.pinned order by l.updated_at desc limit 20
  ),
  linked as (
    select
      nl.note_id,
      jsonb_agg(
        jsonb_build_object(
          'kind', case when nl.task_id is null then 'milestone' else 'task' end,
          'title', coalesce(t.title, m.title)
        )
        order by nl.created_at
      ) as links
    from public.note_links nl
    left join public.tasks t on t.id = nl.task_id
    join public.milestones m on m.id = coalesce(nl.milestone_id, t.milestone_id)
    where nl.user_id = _uid
      and m.user_id = _uid
      and m.status = 'active'
      and (nl.task_id is null or t.status <> 'done')
      and nl.note_id in (select l.id from live l)
    group by nl.note_id
    order by max(nl.created_at) desc
    limit 20
  ),
  matched as (
    select l.id, ts_rank(l.search_vector, _tsq)::real as rank
    from live l
    where _tsq is not null and l.search_vector @@ _tsq
    order by rank desc, l.updated_at desc
    limit 3
  )
  select
    l.id,
    l.title,
    l.updated_at,
    l.pinned,
    exists (select 1 from recent r where r.id = l.id) as recent,
    coalesce(k.links, '[]'::jsonb) as links,
    x.rank as match_rank,
    case
      when exists (select 1 from pinned p where p.id = l.id) or k.note_id is not null or x.id is not null
        then left(l.content_text, _chars)
    end as body,
    l.kind,
    case when l.user_id = _uid then null else public.space_person_name(l.space_id, l.user_id) end,
    l.role
  from live l
  left join linked k on k.note_id = l.id
  left join matched x on x.id = l.id
  where exists (select 1 from recent r where r.id = l.id)
    or exists (select 1 from pinned p where p.id = l.id)
    or k.note_id is not null
    or x.id is not null
  order by l.updated_at desc;
end;
$$;
revoke execute on function public.jarvis_notes(text, integer, uuid) from public, anon;
grant execute on function public.jarvis_notes(text, integer, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: what happens to folders and sharing, never names or content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_folder_created', 'notes', true),
  ('note_folder_updated', 'notes', true),
  ('note_folder_deleted', 'notes', true),
  ('note_moved', 'notes', true),
  ('note_shared', 'notes', true),
  ('note_share_updated', 'notes', true),
  ('note_share_removed', 'notes', true),
  ('note_folder_private_set', 'notes', true),
  ('note_dismissed', 'notes', true),
  ('note_version_restored', 'notes', true)
on conflict (event) do nothing;
