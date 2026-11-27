-- =============================================================================
-- A guide in every section and Grady's own guide (step 30.8)
--   * guide_answers: Grady's answers to questions about the app, kept so the
--     same question is free and instant the next time. The key is a SHA-256
--     of the normalised question, the section, the role, the language, the
--     version of the catalog of controls (ui-map.ts) and which of the
--     elements the question is about the person has; the answer is the
--     model's JSON (steps are checked again against every person's rights
--     when read). No account in it. Only the server reads and writes it
--     (RLS on, no policies, no grants).
--   * guide_questions: what people ask, for the administration's "What people
--     ask about" (the question with numbers, e-mails and links removed, the
--     section, the role, how it was answered, whether internal). No account,
--     never linked back to one. Server only, like guide_answers.
--   * admin_guide_top_questions(): the most asked questions by section in a
--     period, internal accounts left out (service role only).
--   * purge_guide(): questions after 13 months, answers not used for 60 days.
--   * user_settings.guide_offers (false = "don't offer help again") and
--     guide_seen (sections whose first visit was already met with the offer
--     of a quick look): the person's own settings, written by the client.
--   * analytics_event_catalog: the events of the guides.
-- Additive only: new tables, new columns with defaults, new functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The cache of answers
-- -----------------------------------------------------------------------------

create table if not exists public.guide_answers (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  section text not null check (section ~ '^[A-Za-z]{1,40}$'),
  role text not null check (role in ('owner', 'worker', 'admin')),
  locale text not null check (locale in ('cs', 'en')),
  map_version text not null check (map_version ~ '^[0-9a-z]{1,40}$'),
  answer jsonb not null check (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 20000),
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now()
);

alter table public.guide_answers enable row level security;
revoke all on table public.guide_answers from public, anon, authenticated;
grant select, insert, update, delete on table public.guide_answers to service_role;

create index if not exists guide_answers_last_hit_idx on public.guide_answers (last_hit_at);

-- -----------------------------------------------------------------------------
-- 2. What people ask
-- -----------------------------------------------------------------------------

create table if not exists public.guide_questions (
  id bigint generated always as identity primary key,
  section text not null check (section ~ '^[A-Za-z]{1,40}$'),
  role text not null check (role in ('owner', 'worker', 'admin')),
  locale text not null check (locale in ('cs', 'en')),
  question text not null check (char_length(question) between 1 and 200),
  question_norm text not null check (char_length(question_norm) between 1 and 300),
  outcome text not null check (outcome in ('steps', 'words', 'chat', 'noRight', 'missing', 'failed')),
  cached boolean not null default false,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.guide_questions enable row level security;
revoke all on table public.guide_questions from public, anon, authenticated;
grant select, insert, delete on table public.guide_questions to service_role;
grant usage on sequence public.guide_questions_id_seq to service_role;

create index if not exists guide_questions_created_idx on public.guide_questions (created_at);
create index if not exists guide_questions_section_idx on public.guide_questions (section, question_norm);

-- The most asked questions of a period by section: how often, how many found no steps,
-- and the latest wording of each (the normalised text groups "Jak…?" and "jak…").
create or replace function public.admin_guide_top_questions(
  _since timestamptz,
  _until timestamptz,
  _limit integer default 20
)
returns table (
  section text,
  question text,
  asked bigint,
  unanswered bigint,
  last_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with grouped as (
    select
      q.section,
      q.question_norm,
      count(*) as asked,
      count(*) filter (where q.outcome in ('words', 'missing', 'failed')) as unanswered,
      max(q.created_at) as last_at,
      (array_agg(q.question order by q.created_at desc))[1] as question
    from public.guide_questions q
    where q.created_at >= _since
      and q.created_at < _until
      and not q.internal
    group by q.section, q.question_norm
  )
  select g.section, g.question, g.asked, g.unanswered, g.last_at
  from grouped g
  order by g.asked desc, g.last_at desc
  limit least(greatest(coalesce(_limit, 20), 1), 100);
$$;
revoke all on function public.admin_guide_top_questions(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.admin_guide_top_questions(timestamptz, timestamptz, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. Retention
-- -----------------------------------------------------------------------------

create or replace function public.purge_guide()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
  stale integer;
begin
  delete from public.guide_questions where created_at < now() - interval '13 months';
  get diagnostics removed = row_count;
  delete from public.guide_answers where last_hit_at < now() - interval '60 days';
  get diagnostics stale = row_count;
  return removed + stale;
end;
$$;
revoke all on function public.purge_guide() from public, anon, authenticated;
grant execute on function public.purge_guide() to service_role;

-- -----------------------------------------------------------------------------
-- 4. The person's own settings of the guide
-- -----------------------------------------------------------------------------

create or replace function public.valid_guide_seen(_sections text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _sections is not null
    and coalesce(cardinality(_sections), 0) <= 40
    and not exists (select 1 from unnest(_sections) s where s is null or s !~ '^[A-Za-z]{1,40}$');
$$;
revoke execute on function public.valid_guide_seen(text[]) from public, anon;
grant execute on function public.valid_guide_seen(text[]) to authenticated, service_role;

alter table public.user_settings
  add column if not exists guide_offers boolean not null default true,
  add column if not exists guide_seen text[] not null default '{}';

alter table public.user_settings
  add constraint user_settings_guide_seen_valid check (public.valid_guide_seen(guide_seen));

-- -----------------------------------------------------------------------------
-- 5. Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('guide_menu_opened', 'onboarding', false),
  ('guide_started', 'onboarding', false),
  ('guide_finished', 'onboarding', false),
  ('guide_abandoned', 'onboarding', false),
  ('guide_done_for_me', 'onboarding', false),
  ('guide_offer', 'onboarding', false),
  ('guide_question_asked', 'jarvis', true),
  ('guide_idea_suggested', 'jarvis', true)
on conflict (event) do nothing;
