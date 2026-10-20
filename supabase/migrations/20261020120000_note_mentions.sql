-- =============================================================================
-- Mentions of records in notes (step 15.3)
--   * typing @ in a note inserts a chip for a contact, deal, calendar event or
--     worker; the editor keeps it as a node of the document:
--       {"type": "mention", "attrs": {"type": "contact", "id": "<uuid>", "label": "Jan Novák"}}
--   * note_mentions: which records a note mentions, so a contact, deal, event
--     or worker can show "Mentioned in notes". It is derived from the note's
--     content by a trigger on every save; the client only reads it.
--   * a record is listed only when it is the note owner's own row (a worker
--     belongs to the owner through workers.owner_id); a forged id of someone
--     else's record never makes a row.
--   * a mention of a record that is gone later stays in the note (the chip is
--     struck through) and its row here is harmless: nothing shows it.
-- =============================================================================

create table public.note_mentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  target_type text not null check (target_type in ('contact', 'deal', 'event', 'worker')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (note_id, target_type, target_id)
);

create index note_mentions_target_idx on public.note_mentions (user_id, target_type, target_id);

alter table public.note_mentions enable row level security;

create policy note_mentions_select_own on public.note_mentions for select to authenticated
  using ((select auth.uid()) = user_id);

-- Written only by the trigger below: no insert, update or delete for clients.
revoke all on public.note_mentions from anon, authenticated;
grant select on public.note_mentions to authenticated;

-- -----------------------------------------------------------------------------
-- notes_sync_mentions(): after a note's content changes, its rows above match
-- the mention nodes in it. A definer function because clients can not write
-- note_mentions; it works only with the row that was just written (which RLS
-- already limited to the caller's own note) and only lists records of the
-- note's owner. At most 200 mentions per note are kept.
-- A failure here never blocks saving the note: the list is derived data and
-- the next save brings it back in line.
-- -----------------------------------------------------------------------------

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

    insert into public.note_mentions (user_id, note_id, target_type, target_id)
    select new.user_id, new.id, r.target_type, r.target_id
    from unnest(_types, _ids) as r (target_type, target_id)
    where case r.target_type
      when 'contact' then exists (
        select 1 from public.contacts c where c.id = r.target_id and c.user_id = new.user_id)
      when 'deal' then exists (
        select 1 from public.deals d where d.id = r.target_id and d.user_id = new.user_id)
      when 'event' then exists (
        select 1 from public.calendar_events e where e.id = r.target_id and e.user_id = new.user_id)
      when 'worker' then exists (
        select 1 from public.workers w where w.id = r.target_id and w.owner_id = new.user_id)
      else false
    end
    on conflict (note_id, target_type, target_id) do nothing;
  exception when others then
    raise warning 'notes_sync_mentions(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.notes_sync_mentions() from public, anon, authenticated;

create trigger notes_sync_mentions_insert after insert on public.notes
  for each row execute function public.notes_sync_mentions();
create trigger notes_sync_mentions_update after update of content on public.notes
  for each row when (old.content is distinct from new.content)
  execute function public.notes_sync_mentions();

-- -----------------------------------------------------------------------------
-- Analytics: which kinds of records notes point to, never names or content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_mention_added', 'notes', true),
  ('note_mention_opened', 'notes', true);
