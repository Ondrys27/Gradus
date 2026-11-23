-- =============================================================================
-- Notes: several people writing at once (step 28.4)
--   * notes.ydoc: the note's shared document as a Yjs state (text: the editor's
--     XML fragment, a map: its nodes), notes.ydoc_version the lock: a save
--     goes through only from the version it was made on, so a newer state is
--     never overwritten; the browser merges the newer state and saves again.
--     content and content_text stay the derived copy for search, Grady and
--     export, written in the same statement.
--   * The state is written only by note_collab_save (the owner or an editor of
--     the note, read-only spaces refused by notes_enforce_writable). Any other
--     change of the text (an older client, Grady's Undo, a conversion) drops
--     the state: the next one to open the note builds it again from content.
--   * Versions (28.3): live saves of several people go into one version per
--     ten minutes with every author in note_versions.authors; closing the
--     note (note_version_checkpoint) ends the version.
--   * The live channel note:<id> on Supabase Realtime is private: the people
--     who reach the note receive and show they are there, only the owner and
--     editors send changes (policies on realtime.messages).
-- =============================================================================

alter table public.notes add column ydoc bytea;
alter table public.notes add column ydoc_version integer not null default 0;
alter table public.notes add constraint notes_ydoc_size
  check (ydoc is null or octet_length(ydoc) <= 2000000);
comment on column public.notes.ydoc is
  'Yjs state of the note (28.4), written only by note_collab_save; null = built again from content on the next open.';
comment on column public.notes.ydoc_version is
  'Lock of the live state: every save of ydoc (or a change of the text without it) adds one.';

alter table public.note_versions add column authors uuid[] not null default '{}';
alter table public.note_versions add column closed boolean not null default false;

-- -----------------------------------------------------------------------------
-- notes_guard: as in 28.3, and the live state follows the text
-- -----------------------------------------------------------------------------

create or replace function public.notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _transfer boolean := coalesce(current_setting('gradus.notes_transfer', true), '') = 'on';
  _collab boolean := coalesce(current_setting('gradus.note_collab', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
    new.ydoc := null;
    new.ydoc_version := 0;
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
    new.ydoc := old.ydoc;
    new.ydoc_version := old.ydoc_version;
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

  -- The live state: note_collab_save writes it with the text; any other change
  -- of the text or kind drops it (built again from content), nothing else
  -- touches it.
  if _collab then
    new.ydoc_version := old.ydoc_version + 1;
  else
    new.ydoc := old.ydoc;
    if new.content is distinct from old.content
      or new.title is distinct from old.title
      or new.kind is distinct from old.kind then
      new.ydoc := null;
      new.ydoc_version := old.ydoc_version + 1;
    else
      new.ydoc_version := old.ydoc_version;
    end if;
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

-- -----------------------------------------------------------------------------
-- Versions: live saves share one version per ten minutes, with every author
-- -----------------------------------------------------------------------------

create or replace function public.notes_keep_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _by uuid := coalesce(auth.uid(), new.user_id);
  _collab boolean := coalesce(current_setting('gradus.note_collab', true), '') = 'on';
  _authors uuid[];
  _last public.note_versions%rowtype;
begin
  begin
    _authors := coalesce(
      nullif(string_to_array(coalesce(current_setting('gradus.note_authors', true), ''), ','), '{}')::uuid[],
      array[_by]
    );
    if not (_by = any (_authors)) then
      _authors := _authors || _by;
    end if;
    if tg_op = 'INSERT' and new.content_text = '' then
      return null;
    end if;
    select * into _last from public.note_versions v
    where v.note_id = new.id order by v.created_at desc limit 1;
    -- The text from before versions existed is the first one.
    if tg_op = 'UPDATE' and _last.id is null and old.content_text <> '' then
      insert into public.note_versions
        (note_id, space_id, saved_by, kind, title, content, content_text, authors, created_at, updated_at)
      values
        (old.id, old.space_id, old.user_id, old.kind, old.title, old.content, old.content_text,
         array[old.user_id], old.updated_at, old.updated_at)
      returning * into _last;
    end if;
    if _last.id is not null
      and not _last.closed
      and _last.created_at > now() - interval '10 minutes'
      and (_collab or _last.saved_by is not distinct from _by) then
      update public.note_versions
      set kind = new.kind, title = new.title, content = new.content,
          content_text = new.content_text, updated_at = now(), saved_by = _by,
          authors = (
            select coalesce(array_agg(distinct a), '{}') from unnest(_last.authors || _authors) a
          )
      where id = _last.id;
    else
      insert into public.note_versions
        (note_id, space_id, saved_by, kind, title, content, content_text, authors)
      values (new.id, new.space_id, _by, new.kind, new.title, new.content, new.content_text, _authors);
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

-- The versions for the history with the names of everyone who wrote them.
drop function public.note_versions_list(uuid, integer);
create function public.note_versions_list(_note uuid, _limit integer default 50)
returns table (
  id uuid,
  saved_by uuid,
  saved_by_name text,
  author_names text[],
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
    coalesce((
      select array_agg(n.name order by n.name)
      from (
        select distinct nullif(public.space_person_name(v.space_id, a), '') as name
        from unnest(case when cardinality(v.authors) > 0 then v.authors else array[v.saved_by] end) a
      ) n
      where n.name is not null
    ), '{}'),
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
-- The live save
-- -----------------------------------------------------------------------------

-- Saves the note's Yjs state with its derived text when the stored state is
-- still the one the browser built on (_base). Otherwise it answers 'conflict'
-- with the stored state: the browser merges it and saves again. 'missing' =
-- no such note (yet: a note made in the browser is inserted by its autosave),
-- 'deleted' = in the trash, 'denied' = the account may not write it.
create or replace function public.note_collab_save(
  _note uuid,
  _base integer,
  _ydoc bytea,
  _kind text,
  _title text,
  _content jsonb,
  _content_text text,
  _authors uuid[] default '{}'
)
returns table (status text, version integer, ydoc bytea, kind text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.notes%rowtype;
  _role text;
  _valid uuid[];
  _version integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into _row from public.notes n where n.id = _note for update;
  if not found then
    return query select 'missing'::text, null::integer, null::bytea, null::text;
    return;
  end if;
  select r.role into _role from public.note_role(_note) r;
  if _role is null or _role not in ('owner', 'editor') then
    return query select 'denied'::text, null::integer, null::bytea, null::text;
    return;
  end if;
  if _row.deleted_at is not null then
    return query select 'deleted'::text, null::integer, null::bytea, null::text;
    return;
  end if;
  if _row.ydoc_version <> _base or _row.kind <> _kind then
    return query select 'conflict'::text, _row.ydoc_version, _row.ydoc, _row.kind;
    return;
  end if;
  if _ydoc is null or octet_length(_ydoc) > 2000000 then
    return query select 'too_large'::text, null::integer, null::bytea, null::text;
    return;
  end if;

  -- Who wrote it, for the history: the caller and members of the note's space.
  select coalesce(array_agg(distinct a), '{}') into _valid
  from (
    select a from unnest(coalesce(_authors, '{}')) a
    where a = auth.uid() or public.space_member_of(_row.space_id, a)
    limit 20
  ) s;
  if not (auth.uid() = any (_valid)) then
    _valid := _valid || auth.uid();
  end if;

  perform set_config('gradus.note_collab', 'on', true);
  perform set_config('gradus.note_authors', array_to_string(_valid, ','), true);
  update public.notes n
  set ydoc = _ydoc, title = _title, content = _content, content_text = _content_text
  where n.id = _note
  returning n.ydoc_version into _version;
  perform set_config('gradus.note_collab', '', true);
  perform set_config('gradus.note_authors', '', true);
  return query select 'saved'::text, _version, null::bytea, _row.kind;
end;
$$;
revoke execute on function public.note_collab_save(uuid, integer, bytea, text, text, jsonb, text, uuid[])
  from public, anon;
grant execute on function public.note_collab_save(uuid, integer, bytea, text, text, jsonb, text, uuid[])
  to authenticated;

-- Closing the note ends the version it was writing into (the next save
-- starts a new one): a snapshot at every close.
create or replace function public.note_version_checkpoint(_note uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.note_versions v set closed = true
  where v.id = (
    select k.id from public.note_versions k where k.note_id = _note
    order by k.created_at desc limit 1
  )
  and exists (select 1 from public.note_role(_note) r where r.role in ('owner', 'editor'));
$$;
revoke execute on function public.note_version_checkpoint(uuid) from public, anon;
grant execute on function public.note_version_checkpoint(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The live channel: note:<id>. Whoever reaches the note receives and shows
-- they are there; only the owner and editors send changes (not in a
-- read-only space). Realtime checks it when the channel is joined.
-- -----------------------------------------------------------------------------

create or replace function public.note_collab_topic_allowed(_topic text, _send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _role text;
  _space uuid;
begin
  if auth.uid() is null or _topic is null
    or _topic !~ '^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  _id := substring(_topic from 6)::uuid;
  select r.role into _role from public.note_role(_id) r;
  if _role is null then
    return false;
  end if;
  if not _send then
    return true;
  end if;
  select n.space_id into _space from public.notes n where n.id = _id and n.deleted_at is null;
  return _role in ('owner', 'editor') and _space is not null and not public.workspace_read_only(_space);
end;
$$;
revoke execute on function public.note_collab_topic_allowed(text, boolean) from public, anon;
grant execute on function public.note_collab_topic_allowed(text, boolean) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy note_collab_receive on realtime.messages for select to authenticated
      using (
        realtime.messages.extension in ('broadcast', 'presence')
        and public.note_collab_topic_allowed((select realtime.topic()), false)
      )
    $p$;
    execute $p$
      create policy note_collab_send on realtime.messages for insert to authenticated
      with check (
        (realtime.messages.extension = 'presence'
          and public.note_collab_topic_allowed((select realtime.topic()), false))
        or (realtime.messages.extension = 'broadcast'
          and public.note_collab_topic_allowed((select realtime.topic()), true))
      )
    $p$;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics: joining, the limits and merges, never content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_live_opened', 'notes', false),
  ('note_live_limited', 'notes', false),
  ('note_live_merged', 'notes', false)
on conflict (event) do nothing;
