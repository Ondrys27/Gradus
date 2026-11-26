-- 30.1: e-mail overview, the administrators' daily summary, notes in the error log.
--
--   * email_log: one row per e-mail handed to Resend, written only by the
--     server in sendEmail() (src/lib/email/resend.ts): the kind, the
--     recipient as a keyed hash (never the address), the outcome, Resend's id.
--     Read by admin_email_usage() for the administration's E-mails widget.
--   * admin_notify_prefs: each administrator's daily summary "Gradus včera"
--     (on by default, the hour in their time zone, only when there is news).
--   * admin_digest_sends: one summary per administrator and reported day, so
--     the daily job can run twice without sending twice.
--   * error_groups.note: what the triage found and did (cause, commit).
--
-- All server only: RLS on, no policies, no grants to anon or authenticated.
-- Additive: new tables, new columns with defaults or null.

-- ---------------------------------------------------------------------------
-- email_log
-- ---------------------------------------------------------------------------
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  -- src/lib/email/kinds.ts; a new kind needs no migration.
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- fingerprint('email', address) of request-info.ts: a keyed hash.
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{16,64}$'),
  status text not null check (status in ('sent', 'scheduled', 'failed', 'cancelled')),
  provider_id text check (provider_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  scheduled_for timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.email_log is
  'Every e-mail the app handed to Resend: kind, hashed recipient, outcome. Written only by the server (sendEmail), read only by the server.';

create index email_log_created_idx on public.email_log (created_at desc);
create index email_log_provider_idx on public.email_log (provider_id) where provider_id is not null;

alter table public.email_log enable row level security;
revoke all on table public.email_log from anon, authenticated;

-- What the widget shows: e-mails today and this month (sent and scheduled;
-- failed and cancelled ones do not count towards Resend's quota), the
-- month by kind and the last 31 days, in the zone of the metrics.
create or replace function public.admin_email_usage(_tz text default 'Europe/Prague')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone _tz)) at time zone _tz as day_start,
           (date_trunc('month', now() at time zone _tz)) at time zone _tz as month_start,
           (date_trunc('day', now() at time zone _tz) - interval '30 days') at time zone _tz as series_start
  ),
  counted as (
    select l.kind, l.created_at
    from public.email_log l, bounds b
    where l.status in ('sent', 'scheduled')
      and l.created_at >= least(b.month_start, b.series_start)
  )
  select jsonb_build_object(
    'today', (select count(*) from counted c, bounds b where c.created_at >= b.day_start),
    'month', (select count(*) from counted c, bounds b where c.created_at >= b.month_start),
    'failed_month', (
      select count(*) from public.email_log l, bounds b
      where l.status = 'failed' and l.created_at >= b.month_start
    ),
    'by_kind', coalesce((
      select jsonb_object_agg(k.kind, k.n)
      from (
        select c.kind, count(*) as n
        from counted c, bounds b
        where c.created_at >= b.month_start
        group by c.kind
      ) k
    ), '{}'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
      from (
        select (c.created_at at time zone _tz)::date as day, count(*) as n
        from counted c, bounds b
        where c.created_at >= b.series_start
        group by 1
      ) d
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.admin_email_usage(text) from public, anon, authenticated;
grant execute on function public.admin_email_usage(text) to service_role;

-- ---------------------------------------------------------------------------
-- The daily summary to administrators
-- ---------------------------------------------------------------------------
alter table public.admin_notify_prefs
  add column digest_enabled boolean not null default true,
  -- The hour of the day it arrives, in digest_time_zone (or the account's zone).
  add column digest_hour smallint not null default 6 check (digest_hour between 0 and 23),
  -- Only on a day with something to report (new errors, reports, a failing system…).
  add column digest_only_news boolean not null default false,
  add column digest_time_zone text
    check (digest_time_zone is null or digest_time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{1,63}$');

create table public.admin_digest_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The reported day ("yesterday"), in the zone of the metrics.
  day date not null,
  status text not null check (status in ('scheduled', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz,
  provider_id text check (provider_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
comment on table public.admin_digest_sends is
  'One daily summary per administrator and reported day (the cron job admin-digest). Server only.';
alter table public.admin_digest_sends enable row level security;
revoke all on table public.admin_digest_sends from anon, authenticated;

-- What the summary says about one day (in the zone of the metrics) that the
-- metric registry does not count: errors first seen that day or back that
-- day (the end-to-end tests' own, transport mock, and ignored groups left
-- out), the three most frequent of them with their code, groups resolved
-- that day, and new reports, ideas and survey answers. Counts and codes only.
create or replace function public.admin_digest_facts(_day date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (_day::timestamp at time zone public.metrics_timezone()) as starts,
           ((_day + 1)::timestamp at time zone public.metrics_timezone()) as ends
  ),
  day_events as (
    select e.fingerprint, e.code, e.message, e.created_at
    from public.error_events e, bounds b
    where e.created_at >= b.starts and e.created_at < b.ends and e.transport = 'resend'
  ),
  grouped as (
    select d.fingerprint,
           count(*)::integer as n,
           (array_agg(d.code order by d.created_at desc))[1] as code,
           (array_agg(d.message order by d.created_at desc))[1] as message,
           coalesce(g.status, 'new') as status,
           g.returned_at
    from day_events d
    left join public.error_groups g on g.fingerprint = d.fingerprint
    group by d.fingerprint, g.status, g.returned_at
  ),
  fresh as (
    select gr.*
    from grouped gr, bounds b
    where gr.status <> 'ignored'
      and (
        gr.returned_at >= b.starts
        or not exists (
          select 1 from public.error_events o
          where o.fingerprint = gr.fingerprint and o.created_at < b.starts
        )
      )
  )
  select jsonb_build_object(
    'new_errors', (select count(*) from fresh),
    'error_occurrences', (select coalesce(sum(n), 0) from grouped where status <> 'ignored'),
    'top_errors', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'message', left(t.message, 120), 'occurrences', t.n)
                       order by t.n desc)
      from (select * from fresh order by n desc, code limit 3) t
    ), '[]'::jsonb),
    'resolved_errors', (
      select count(*) from public.error_groups g, bounds b
      where g.status = 'resolved' and g.resolved_at >= b.starts and g.resolved_at < b.ends
    ),
    'reports', (
      select count(*) from public.bug_reports r, bounds b
      where r.created_at >= b.starts and r.created_at < b.ends
    ),
    'ideas', (
      select count(*) from public.feature_requests f, bounds b
      where f.created_at >= b.starts and f.created_at < b.ends
    ),
    'survey', (
      select count(*) from public.satisfaction_responses s, bounds b
      where s.created_at >= b.starts and s.created_at < b.ends
    )
  );
$$;
revoke all on function public.admin_digest_facts(date) from public, anon, authenticated;
grant execute on function public.admin_digest_facts(date) to service_role;

-- ---------------------------------------------------------------------------
-- Notes in the error log
-- ---------------------------------------------------------------------------
alter table public.error_groups
  add column note text check (note is null or char_length(note) between 1 and 500);

-- ---------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- ---------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('admin_digest_sent', 'platform', false),
  ('admin_digest_prefs_saved', 'platform', false)
on conflict (event) do nothing;

-- ---------------------------------------------------------------------------
-- Housekeeping: kept 13 months like the other records (cron error-alerts).
-- ---------------------------------------------------------------------------
create or replace function public.purge_email_log()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.email_log where created_at < now() - interval '13 months';
  get diagnostics removed = row_count;
  delete from public.admin_digest_sends where created_at < now() - interval '13 months';
  return removed;
end;
$$;
revoke all on function public.purge_email_log() from public, anon, authenticated;
grant execute on function public.purge_email_log() to service_role;
