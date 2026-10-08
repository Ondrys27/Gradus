-- =============================================================================
-- Feedback: NPS and Jarvis answer ratings (step 11.5)
--   * nps_responses: one optional score (0-10) and comment per user, asked
--     once after 7 days of use; profiles.nps_asked_at marks the question as
--     asked (answered or dismissed) so it never shows again.
--   * jarvis_messages.rating: thumb up/down on an assistant answer, written
--     by the server (the client only asks through /api/jarvis).
--   * admin_audit_kind gains 'update' for the few edits the administration
--     makes itself (an idea's status, an account's internal flag).
--   * Three new catalog events (src/lib/analytics/events.ts mirrors this).
-- =============================================================================

alter type public.admin_audit_kind add value 'update';

alter table public.profiles
  add column nps_asked_at timestamptz;
comment on column public.profiles.nps_asked_at is
  'Set once the NPS question has been answered or dismissed; it is then never shown again.';

create table public.nps_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  score smallint not null check (score between 0 and 10),
  comment text,
  created_at timestamptz not null default now()
);
create index nps_responses_user_idx on public.nps_responses (user_id, created_at desc);
create index nps_responses_created_idx on public.nps_responses (created_at desc);

alter table public.nps_responses enable row level security;
create policy "nps_responses_select_own" on public.nps_responses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "nps_responses_insert_own" on public.nps_responses for insert to authenticated
  with check ((select auth.uid()) = user_id);
-- No update or delete policy: an answer, once given, stays as it was.

alter table public.jarvis_messages
  add column rating text check (rating in ('up', 'down'));
comment on column public.jarvis_messages.rating is
  'Thumb up/down on an assistant answer. Written by the server only (the admin client), through /api/jarvis; jarvis_messages carries no client update policy.';

insert into public.analytics_event_catalog (event, section, active) values
  ('jarvis_message_rated', 'jarvis', false),
  ('nps_submitted', 'platform', false),
  ('nps_dismissed', 'platform', false);
