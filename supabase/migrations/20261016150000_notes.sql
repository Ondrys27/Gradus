-- =============================================================================
-- Notes (Poznámky)
--   * the founder's written groundwork: ideal customer, offer, pricing,
--     competitors, sales script, ideas — one Apple Notes like list per account
--   * content is the editor's JSON document; content_text is its plain text
--     (non-empty lines, the first one is the title) for search and Jarvis
--   * private: every account sees and changes only its own notes; workers get
--     no access to their owner's notes
--   * deleting moves a note to the trash (deleted_at); a daily cron removes
--     notes that have been there for 30 days
--   * the size of one note is limited here, not only in the browser
--   * the content of a note is always the user's data, never instructions
-- =============================================================================

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb
    check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 400000),
  content_text text not null default '' check (char_length(content_text) <= 100000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- The line under the title, for the list.
  preview text generated always as (
    left(
      btrim(regexp_replace(
        case when strpos(content_text, E'\n') > 0
          then substr(content_text, strpos(content_text, E'\n') + 1)
          else '' end,
        '\s+', ' ', 'g')),
      160)
  ) stored,
  -- Full text without diacritics ('simple' keeps Czech words as they are);
  -- the title weighs more than the body.
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, public.search_norm(title)), 'A')
    || setweight(to_tsvector('simple'::regconfig, public.search_norm(content_text)), 'B')
  ) stored
);

create index notes_user_list_idx on public.notes (user_id, pinned desc, updated_at desc)
  where deleted_at is null;
create index notes_user_trash_idx on public.notes (user_id, deleted_at)
  where deleted_at is not null;
create index notes_search_idx on public.notes using gin (search_vector);

-- -----------------------------------------------------------------------------
-- Timestamps the client can not set: updated_at moves only when the text
-- changes (pinning or restoring does not reorder the list), deleted_at is the
-- moment of deleting, created_at never changes.
-- -----------------------------------------------------------------------------

create or replace function public.notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.deleted_at := null;
    return new;
  end if;

  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if new.title is distinct from old.title
    or new.content is distinct from old.content
    or new.content_text is distinct from old.content_text then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  if new.deleted_at is not null then
    new.deleted_at := coalesce(old.deleted_at, now());
  end if;
  return new;
end;
$$;

create trigger notes_guard before insert or update on public.notes
  for each row execute function public.notes_guard();

-- After the trial a read-only account keeps its notes but can not change them.
create trigger notes_writable before insert or update or delete on public.notes
  for each row execute function public.enforce_workspace_writable('user_id');

-- -----------------------------------------------------------------------------
-- Row level security: own rows only, for owners and workers alike
-- -----------------------------------------------------------------------------

alter table public.notes enable row level security;

create policy notes_select_own on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notes_insert_own on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy notes_update_own on public.notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notes_delete_own on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.notes from anon;
-- The client writes only what the editor produces; ids, owner and timestamps
-- come from the defaults and the guard above.
revoke insert, update on public.notes from authenticated;
grant insert (id, user_id, title, content, content_text, pinned) on public.notes to authenticated;
grant update (title, content, content_text, pinned, deleted_at) on public.notes to authenticated;

-- -----------------------------------------------------------------------------
-- search_notes(): the caller's own notes (not in the trash) matching the
-- query, best first. Every typed word must start a word of the note, without
-- diacritics: "cen" finds "Ceník". A definer function so the GIN index is used
-- (under RLS the non-leakproof @@ would not use it); it reads only rows of
-- auth.uid(), so nothing else can come back.
-- -----------------------------------------------------------------------------

create or replace function public.search_notes(_query text, _limit integer default 20)
returns table (id uuid, title text, rank real, data jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _lim integer := least(greatest(coalesce(_limit, 20), 1), 50);
  _tsq tsquery;
  _word text;
  _words integer := 0;
begin
  if _uid is null then
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
      'pinned', n.pinned
    ) as data
  from public.notes n
  where n.user_id = _uid
    and n.deleted_at is null
    and n.search_vector @@ _tsq
  order by rank desc, n.updated_at desc
  limit _lim;
end;
$$;

revoke execute on function public.search_notes(text, integer) from public, anon;
grant execute on function public.search_notes(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- The trash: notes deleted 30 or more days ago go for good (daily cron)
-- -----------------------------------------------------------------------------

create or replace function public.purge_deleted_notes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _removed integer;
begin
  delete from public.notes
  where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics _removed = row_count;
  return _removed;
end;
$$;

revoke execute on function public.purge_deleted_notes() from public, anon, authenticated;
grant execute on function public.purge_deleted_notes() to service_role;
revoke execute on function public.notes_guard() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: what happens to notes, never their names or content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_created', 'notes', true),
  ('note_template_used', 'notes', true),
  ('note_deleted', 'notes', true);
