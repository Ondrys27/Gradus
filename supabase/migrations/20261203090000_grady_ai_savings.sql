-- =============================================================================
-- Grady: quality for the lowest price (step 28.9)
--
--   * ai_usage.batch: the call went through the Message Batches API (half
--     price, answered later): the morning briefs and the opportunity watch.
--     Written by the server like the rest of the row; default false.
--   * grady_batches: the batches sent to the API and not yet collected
--     (kind briefing | watch, the batch id, what each request is for). Only
--     the server reads and writes it (RLS on, no policies, no grants).
--   * jarvis_space_calls() also leaves out the administration's model
--     comparison (model_compare, compare_judge): the owner's test runs are
--     paid from the app's budget, not from the plan's monthly answers.
--   * admin_ai_model_usage_by_tier(): admin_ai_model_usage() with the batch
--     flag, so the estimates "on Haiku / Sonnet / Opus" price batch tokens at
--     the batch price. Server only.
--   * admin_ai_quality_signals(): by job over a period: calls, re-asks (the
--     same person asked the same job again 20 s – 10 min after the last answer
--     ended; in the chat a rephrased question in the same conversation, trigram
--     similarity ≥ 0.5), failed calls, thumbs up and down, Grady's changes and
--     the undone ones. Counts only, never texts. Server only.
--   * admin_ai_efficiency(): by day in the metrics' zone: active users (the
--     metrics' definition), users of Grady, cost, calls, tokens and cache, the
--     chat's cost and answers, the cost of batch calls; one row without a day
--     for the whole period (distinct users). Internal accounts left out unless
--     asked. Server only.
-- Additive: one new column with a default, one new table, new and replaced functions.
-- =============================================================================

-- pg_trgm is loaded before a function that uses it (see 20261104090000).
select extensions.similarity('', '');

alter table public.ai_usage
  add column if not exists batch boolean not null default false;
comment on column public.ai_usage.batch is
  'The call went through the Message Batches API (half price, answered later; step 28.9).';

create table if not exists public.grady_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('briefing', 'watch')),
  batch_id text not null unique check (char_length(batch_id) between 1 and 200),
  model text not null check (char_length(model) <= 60),
  -- One entry per request: custom_id → the user and what the result needs.
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  status text not null default 'submitted' check (status in ('submitted', 'collected', 'failed')),
  created_at timestamptz not null default now(),
  collected_at timestamptz,
  summary jsonb
);
create index if not exists grady_batches_open on public.grady_batches (created_at)
  where status = 'submitted';
alter table public.grady_batches enable row level security;
revoke all on table public.grady_batches from public, anon, authenticated;
grant all on table public.grady_batches to service_role;
comment on table public.grady_batches is
  'Message batches of Grady''s background jobs waiting to be collected (step 28.9). Server only.';

-- The same function as in 20261123090000_grady_models.sql, without the administration's comparison.
create or replace function public.jarvis_space_calls(_user_id uuid, _space_id uuid, _since timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
  from public.ai_usage u
  where u.user_id = _user_id
    and coalesce(u.space_id, u.user_id) = _space_id
    and u.success
    and u.purpose not in ('chat_route', 'model_compare', 'compare_judge')
    and u.created_at >= _since;
$$;
revoke all on function public.jarvis_space_calls(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_space_calls(uuid, uuid, timestamptz) to service_role;

create or replace function public.admin_ai_model_usage_by_tier(_since timestamptz)
returns table (
  purpose text,
  model text,
  routed_from text,
  long_prompt boolean,
  batch boolean,
  calls bigint,
  input_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  output_tokens bigint,
  cost_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    u.purpose,
    u.model,
    u.routed_from,
    (u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) > 100000,
    u.batch,
    count(*),
    coalesce(sum(u.input_tokens), 0),
    coalesce(sum(u.cache_read_tokens), 0),
    coalesce(sum(u.cache_write_tokens), 0),
    coalesce(sum(u.output_tokens), 0),
    coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  where u.created_at >= _since
  group by 1, 2, 3, 4, 5;
$$;
revoke all on function public.admin_ai_model_usage_by_tier(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_ai_model_usage_by_tier(timestamptz) to service_role;

create or replace function public.admin_ai_quality_signals(_since timestamptz)
returns table (
  purpose text,
  calls bigint,
  asks bigint,
  repeats bigint,
  failures bigint,
  ratings_up bigint,
  ratings_down bigint,
  actions bigint,
  actions_undone bigint
)
language sql
stable
-- Definer: the trigram similarity of pg_trgm, whose functions the service role may not execute.
-- Executed by the service role only (grants below); returns counts, never texts.
security definer
set search_path = ''
as $$
  with calls as (
    select
      u.purpose,
      u.success,
      u.created_at - make_interval(secs => coalesce(u.duration_ms, 0) / 1000.0) as started_at,
      lag(u.created_at) over (partition by u.user_id, u.purpose order by u.created_at) as previous_end
    from public.ai_usage u
    where u.created_at >= _since
      and u.purpose not in ('chat', 'chat_route', 'model_compare', 'compare_judge', 'ping', 'rules_test')
  ),
  jobs as (
    select
      c.purpose,
      count(*) as calls,
      count(*) as asks,
      count(*) filter (
        where c.previous_end is not null
          and c.started_at - c.previous_end between interval '20 seconds' and interval '10 minutes'
      ) as repeats,
      count(*) filter (where not c.success) as failures
    from calls c
    group by c.purpose
  ),
  asked as (
    select
      m.content,
      m.created_at,
      lag(m.content) over (partition by m.conversation_id order by m.created_at) as previous_content,
      lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as previous_at
    from public.jarvis_messages m
    where m.role = 'user' and m.created_at >= _since
  ),
  chat as (
    select
      'chat'::text as purpose,
      (select count(*) from public.ai_usage u where u.purpose = 'chat' and u.created_at >= _since) as calls,
      (select count(*) from asked) as asks,
      (select count(*) from asked a
        where a.previous_at is not null
          and a.created_at - a.previous_at <= interval '10 minutes'
          and extensions.similarity(left(a.content, 500), left(a.previous_content, 500)) >= 0.5) as repeats,
      (select count(*) from public.ai_usage u
        where u.purpose = 'chat' and not u.success and u.created_at >= _since) as failures
  ),
  ratings as (
    select
      count(*) filter (where m.rating = 'up') as up,
      count(*) filter (where m.rating = 'down') as down
    from public.jarvis_messages m
    where m.role = 'assistant' and m.created_at >= _since
  ),
  acts as (
    select
      count(*) filter (where a.status in ('done', 'undone')) as done,
      count(*) filter (where a.status = 'undone') as undone
    from public.grady_actions a
    where a.created_at >= _since
  )
  select j.purpose, j.calls, j.asks, j.repeats, j.failures, 0::bigint, 0::bigint, 0::bigint, 0::bigint
  from jobs j
  union all
  select c.purpose, c.calls, c.asks, c.repeats, c.failures, r.up, r.down, x.done, x.undone
  from chat c, ratings r, acts x;
$$;
revoke all on function public.admin_ai_quality_signals(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_ai_quality_signals(timestamptz) to service_role;

create or replace function public.admin_ai_efficiency(
  _from date,
  _to date,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false
)
returns table (
  day date,
  active_users bigint,
  ai_users bigint,
  cost_usd numeric,
  calls bigint,
  input_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  chat_cost_usd numeric,
  chat_answers bigint,
  batch_cost_usd numeric
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
  _active text[] := public.metric_active_events();
  _start timestamptz := public.metric_day_start(_from, _tz);
  _end timestamptz := public.metric_day_start(_to + 1, _tz);
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, '{}');

  return query
  with days as (
    select d::date as day from generate_series(_from, _to, interval '1 day') d
  ),
  active as (
    select distinct (e.created_at at time zone _tz)::date as day, e.user_id
    from public.analytics_events e
    where e.user_id = any(_users) and e.event = any(_active)
      and e.created_at >= _start and e.created_at < _end
  ),
  usage as (
    select (u.created_at at time zone _tz)::date as day, u.*
    from public.ai_usage u
    where u.user_id = any(_users) and u.created_at >= _start and u.created_at < _end
  ),
  answers as (
    select (m.created_at at time zone _tz)::date as day, count(*) as n
    from public.jarvis_messages m
    where m.user_id = any(_users) and m.role = 'assistant'
      and m.created_at >= _start and m.created_at < _end
    group by 1
  ),
  per_day as (
    select
      d.day,
      (select count(*) from active a where a.day = d.day) as active_users,
      (select count(distinct u.user_id) from usage u where u.day = d.day) as ai_users,
      coalesce((select sum(u.cost_usd) from usage u where u.day = d.day), 0) as cost_usd,
      (select count(*) from usage u where u.day = d.day) as calls,
      coalesce((select sum(u.input_tokens) from usage u where u.day = d.day), 0)::bigint as input_tokens,
      coalesce((select sum(u.cache_read_tokens) from usage u where u.day = d.day), 0)::bigint as cache_read_tokens,
      coalesce((select sum(u.cache_write_tokens) from usage u where u.day = d.day), 0)::bigint as cache_write_tokens,
      coalesce((select sum(u.cost_usd) from usage u
        where u.day = d.day and u.purpose in ('chat', 'chat_route')), 0) as chat_cost_usd,
      coalesce((select a.n from answers a where a.day = d.day), 0)::bigint as chat_answers,
      coalesce((select sum(u.cost_usd) from usage u where u.day = d.day and u.batch), 0) as batch_cost_usd
    from days d
  )
  select p.day, p.active_users, p.ai_users, p.cost_usd, p.calls, p.input_tokens,
    p.cache_read_tokens, p.cache_write_tokens, p.chat_cost_usd, p.chat_answers, p.batch_cost_usd
  from per_day p
  union all
  select
    null::date,
    (select count(distinct a.user_id) from active a),
    (select count(distinct u.user_id) from usage u),
    coalesce(sum(p.cost_usd), 0),
    coalesce(sum(p.calls), 0)::bigint,
    coalesce(sum(p.input_tokens), 0)::bigint,
    coalesce(sum(p.cache_read_tokens), 0)::bigint,
    coalesce(sum(p.cache_write_tokens), 0)::bigint,
    coalesce(sum(p.chat_cost_usd), 0),
    coalesce(sum(p.chat_answers), 0)::bigint,
    coalesce(sum(p.batch_cost_usd), 0)
  from per_day p
  order by 1 nulls last;
end;
$$;
revoke all on function public.admin_ai_efficiency(date, date, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_ai_efficiency(date, date, text, boolean) to service_role;
