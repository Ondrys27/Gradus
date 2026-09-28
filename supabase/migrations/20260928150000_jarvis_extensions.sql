-- =============================================================================
-- Jarvis extensions (prompt 4.2)
--   * jarvis_suggestions: what Jarvis noticed, written only by /api/jarvis; the
--     client reads its own and may only mark them seen or dismissed
--   * jarvis_watch_state: when the opportunity watch last looked at a user
--     (server only)
--   * jarvis_watch_candidates(): users with recent changes, oldest scan first
--   * attachments are recorded by the server, which detects the type from the
--     content; the client reads and deletes its own rows
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Suggestions
-- -----------------------------------------------------------------------------

create table public.jarvis_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady',
    'taskCompleted', 'insight'
  )),
  text text not null check (char_length(text) between 1 and 1000),
  action jsonb not null default '{}' check (jsonb_typeof(action) = 'object'),
  -- One suggestion per event (e.g. "stalledDeal:<deal>:<since>"); null for free-form insights.
  dedupe_key text check (char_length(dedupe_key) <= 200),
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index jarvis_suggestions_user_dedupe_idx
  on public.jarvis_suggestions (user_id, dedupe_key);
create index jarvis_suggestions_user_active_idx
  on public.jarvis_suggestions (user_id, created_at desc) where dismissed_at is null;

create trigger set_updated_at before update on public.jarvis_suggestions
  for each row execute function public.set_updated_at();

alter table public.jarvis_suggestions enable row level security;
create policy "jarvis_suggestions_select_own" on public.jarvis_suggestions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "jarvis_suggestions_update_own" on public.jarvis_suggestions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No insert or delete policies: suggestions come from the server only.

create or replace function public.jarvis_suggestions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and (to_jsonb(new) - array['seen_at', 'dismissed_at', 'updated_at'])
         <> (to_jsonb(old) - array['seen_at', 'dismissed_at', 'updated_at']) then
    raise exception 'jarvis_suggestions_are_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger jarvis_suggestions_guard
  before update on public.jarvis_suggestions
  for each row execute function public.jarvis_suggestions_guard();

comment on table public.jarvis_suggestions is
  'Opportunities and automatic actions of Jarvis. Written only by /api/jarvis; the client marks them seen or dismissed.';

-- -----------------------------------------------------------------------------
-- Opportunity watch state (server only: RLS on, no policies)
-- -----------------------------------------------------------------------------

create table public.jarvis_watch_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_run_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.jarvis_watch_state
  for each row execute function public.set_updated_at();
alter table public.jarvis_watch_state enable row level security;

-- Users who changed something since _active_since, the longest unscanned first.
create or replace function public.jarvis_watch_candidates(_active_since timestamptz, _limit integer)
returns table (user_id uuid, last_run_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with active as (
    select d.user_id from public.deals d where d.updated_at >= _active_since
    union
    select t.user_id from public.tasks t where t.updated_at >= _active_since
    union
    select m.user_id from public.milestones m where m.updated_at >= _active_since
    union
    select c.user_id from public.contact_table_moves c where c.created_at >= _active_since
    union
    select e.user_id from public.calendar_events e where e.updated_at >= _active_since
  )
  select a.user_id, s.last_run_at
  from active a
  left join public.jarvis_watch_state s on s.user_id = a.user_id
  order by s.last_run_at asc nulls first
  limit greatest(_limit, 0);
$$;
revoke execute on function public.jarvis_watch_candidates(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.jarvis_watch_candidates(timestamptz, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Attachments: recorded by the server after checking the content
-- -----------------------------------------------------------------------------

drop policy "attachments_insert_own" on public.attachments;
drop policy "attachments_update_own" on public.attachments;

-- Text taken out of a PDF, DOCX, XLSX, TXT or CSV so later turns can read it again.
alter table public.attachments
  add column extracted_text text check (char_length(extracted_text) <= 200000);

comment on table public.attachments is
  'Files in the attachments bucket. Rows are written by the server with the type detected from the content; the client reads and deletes its own.';

revoke execute on function public.jarvis_suggestions_guard() from public, anon;
