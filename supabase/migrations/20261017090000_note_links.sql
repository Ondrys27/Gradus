-- =============================================================================
-- Notes as the groundwork for milestones and tasks (step 13.4)
--   * note_links: a note belongs to a task or a milestone of the same account.
--     Notes are private, so both sides must be the caller's own rows: a worker
--     can not tie a note to the owner's task, nor anyone to a stranger's.
--   * path_tasks.note_template: path steps whose output is text (describe the
--     customer, build the price list, write the script…) carry the key of a
--     prepared outline (src/features/notes/templates.ts). A user's task reads
--     it through tasks.template_id; nothing is copied.
--   * profiles.notes_intro_seen_at: Jarvis introduced Notes once, never again.
--   * jarvis_notes(): what Jarvis gets to know about the notes before a chat
--     answer: the newest titles, and the full text of pinned notes, notes tied
--     to open milestones and tasks, and the best matches of the message.
--     The text is the user's data, never instructions; the server wraps it so.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Prepared outlines on path steps
-- -----------------------------------------------------------------------------

alter table public.path_tasks
  add column note_template text check (
    note_template in ('idealCustomer', 'offer', 'pricing', 'competition', 'salesScript')
  );

update public.path_tasks pt
set note_template = tag.template
from public.path_milestones pm,
  (values
    ('general', 'offer_pricing', 1, 'idealCustomer'),
    ('general', 'offer_pricing', 2, 'offer'),
    ('general', 'offer_pricing', 3, 'competition'),
    ('general', 'offer_pricing', 4, 'pricing'),
    ('general', 'offer_pricing', 5, 'pricing'),
    ('general', 'first_outreach', 1, 'salesScript'),
    ('general', 'first_meeting', 2, 'salesScript'),
    ('craftsman', 'offer_pricing', 1, 'pricing'),
    ('craftsman', 'offer_pricing', 3, 'pricing'),
    ('consultant', 'offer_pricing', 1, 'idealCustomer'),
    ('consultant', 'offer_pricing', 2, 'offer'),
    ('consultant', 'offer_pricing', 3, 'pricing'),
    ('consultant', 'first_meeting', 2, 'salesScript'),
    ('ecommerce', 'offer_pricing', 4, 'offer'),
    ('ecommerce', 'offer_pricing', 5, 'pricing'),
    ('gastro', 'offer_pricing', 1, 'offer'),
    ('gastro', 'offer_pricing', 3, 'pricing'),
    ('gastro', 'offer_pricing', 4, 'competition'),
    ('personal_services', 'offer_pricing', 1, 'offer'),
    ('personal_services', 'offer_pricing', 2, 'competition'),
    ('personal_services', 'offer_pricing', 3, 'pricing'),
    ('real_estate', 'offer_pricing', 1, 'pricing'),
    ('real_estate', 'offer_pricing', 2, 'idealCustomer'),
    ('real_estate', 'offer_pricing', 5, 'offer'),
    ('fitness', 'offer_pricing', 1, 'idealCustomer'),
    ('fitness', 'offer_pricing', 2, 'offer'),
    ('fitness', 'offer_pricing', 3, 'competition'),
    ('fitness', 'offer_pricing', 4, 'pricing')
  ) as tag (path_key, milestone_key, position, template)
where pm.path_key = tag.path_key
  and pm.key = tag.milestone_key
  and pt.path_milestone_id = pm.id
  and pt.position = tag.position;

-- -----------------------------------------------------------------------------
-- Links between notes and tasks or milestones
-- -----------------------------------------------------------------------------

create table public.note_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(task_id, milestone_id) = 1)
);

create unique index note_links_task_unique on public.note_links (note_id, task_id)
  where task_id is not null;
create unique index note_links_milestone_unique on public.note_links (note_id, milestone_id)
  where milestone_id is not null;
create index note_links_user_idx on public.note_links (user_id, created_at desc);
create index note_links_task_idx on public.note_links (task_id) where task_id is not null;
create index note_links_milestone_idx on public.note_links (milestone_id)
  where milestone_id is not null;

-- A read-only account keeps its links but can not change them.
create trigger note_links_writable before insert or update or delete on public.note_links
  for each row execute function public.enforce_workspace_writable('user_id');

alter table public.note_links enable row level security;

create policy note_links_select_own on public.note_links for select to authenticated
  using ((select auth.uid()) = user_id);

-- Both sides must belong to the caller: the note (own rows only anyway) and
-- the task or milestone (owned, not merely visible through a worker's rights).
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
  );

create policy note_links_delete_own on public.note_links for delete to authenticated
  using ((select auth.uid()) = user_id);

-- A link is made or removed, never changed.
revoke all on public.note_links from anon;
revoke insert, update on public.note_links from authenticated;
grant insert (note_id, task_id, milestone_id) on public.note_links to authenticated;

-- -----------------------------------------------------------------------------
-- Jarvis's one-time introduction of Notes
-- -----------------------------------------------------------------------------

alter table public.profiles add column notes_intro_seen_at timestamptz;

-- -----------------------------------------------------------------------------
-- jarvis_notes(): the caller's notes as Jarvis may know them
--   recent      among the 50 most recently edited
--   links       open milestones and tasks the note belongs to (title, kind)
--   match_rank  one of the 3 best matches of the message (any of its words)
--   body        the text, cut to _body_chars, only for pinned, linked or
--               matching notes
-- A definer function so the GIN index is used; it reads only rows of
-- auth.uid(), so nothing of another account can come back.
-- -----------------------------------------------------------------------------

create or replace function public.jarvis_notes(_query text default null, _body_chars integer default 12000)
returns table (
  id uuid,
  title text,
  updated_at timestamptz,
  pinned boolean,
  recent boolean,
  links jsonb,
  match_rank real,
  body text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _chars integer := least(greatest(coalesce(_body_chars, 12000), 0), 12000);
  _tsq tsquery;
  _word text;
  _words integer := 0;
begin
  if _uid is null then
    return;
  end if;
  -- Any word of the message of three or more letters, at most twelve of them.
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
  with live as (
    select n.id, n.title, n.updated_at, n.pinned, n.content_text, n.search_vector
    from public.notes n
    where n.user_id = _uid and n.deleted_at is null
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
    end as body
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

revoke execute on function public.jarvis_notes(text, integer) from public, anon;
grant execute on function public.jarvis_notes(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: which links are made and how Jarvis's answers reach the notes,
-- never names or content
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('note_linked', 'notes', true),
  ('note_unlinked', 'notes', false),
  ('note_saved_from_jarvis', 'notes', true),
  ('jarvis_notes_intro', 'jarvis', false);
