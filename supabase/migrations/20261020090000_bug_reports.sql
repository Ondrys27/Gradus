-- =============================================================================
-- Bug reports (step 15.2, the base of step 12.4)
--
--   * bug_reports: what people report about a problem. Step 15.2 fills it from
--     the error page ("Send feedback", source 'error_page', with the error
--     code shown there); step 12.4 adds the "Report a problem" dialog, the
--     console errors and the screenshot to this same table.
--     - user_id is null for an anonymous report (the error page works signed
--       out too); the author reads their own rows, nobody else does.
--     - error_code (GR-XXXXXX) is unique: one report per error code, a second
--       click sends nothing new. The same code is in the client_error event of
--       analytics, so the administration finds the error by it.
--     - error_message is the error's text after scrubMessage() (no e-mails, no
--       long numbers, 200 characters), error_digest Next.js's digest of a
--       server error (the key to the server log). Never the content of data.
--     - page is the path with ids and tokens replaced, browser and device the
--       classes analytics uses, never the User-Agent; ip_hash a keyed hash of
--       the address (the per-IP limit of anonymous reports), never the address.
--   * Nobody writes the table from the browser: no INSERT, UPDATE or DELETE
--     policy and no grant. The server writes through bug_report_submit()
--     (service role only), which applies the limits and the one-per-code rule
--     in one transaction.
--   * admin_bug_reports(): the administration's list and its search by code,
--     service role only (the server calls it after the admin guard).
--   * bug_report_sent: a new catalog event (src/lib/analytics/events.ts).
-- =============================================================================

create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  source text not null default 'report' check (source in ('report', 'error_page')),
  kind text not null default 'bug' check (kind in ('bug', 'idea', 'confusing')),
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'fixed', 'cannot_reproduce')),
  description text check (char_length(description) <= 4000),
  expected text check (char_length(expected) <= 4000),
  error_code text unique check (error_code ~ '^GR-[A-Z0-9]{6}$'),
  error_message text check (char_length(error_message) <= 200),
  error_digest text check (error_digest ~ '^[A-Za-z0-9_-]{1,64}$'),
  page text not null check (char_length(page) between 1 and 300),
  browser text check (browser ~ '^[a-z]{1,16}$'),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  viewport text check (viewport ~ '^[0-9]{1,5}x[0-9]{1,5}$'),
  locale text check (locale in ('cs', 'en')),
  app_version text check (app_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  ip_hash text check (ip_hash ~ '^[0-9a-f]{16,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bug_reports is
  'Problems people report (error page now, the Report a problem dialog in step 12.4). The author reads their own rows; written only by the server through bug_report_submit().';

create index bug_reports_created_idx on public.bug_reports (created_at desc);
create index bug_reports_user_idx on public.bug_reports (user_id, created_at desc);
create index bug_reports_ip_idx on public.bug_reports (ip_hash, created_at desc);

alter table public.bug_reports enable row level security;
revoke all on table public.bug_reports from anon;
revoke insert, update, delete, truncate on table public.bug_reports from authenticated;
create policy "bug_reports_select_own" on public.bug_reports for select to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Writing a report (server only)
-- -----------------------------------------------------------------------------

-- Stores one report. Returns 'created', 'duplicate' (a report with this error
-- code exists: nothing is written) or 'limited' (too many reports from this
-- account, or anonymously from this address, in the last hour). The advisory
-- lock serialises the parallel requests of one sender, so the count holds.
create or replace function public.bug_report_submit(
  _user_id uuid,
  _ip_hash text,
  _source text,
  _page text,
  _error_code text default null,
  _description text default null,
  _error_message text default null,
  _error_digest text default null,
  _browser text default null,
  _device text default null,
  _viewport text default null,
  _locale text default null,
  _app_version text default null,
  _limit_user integer default 20,
  _limit_anonymous integer default 5
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  _recent integer;
  _id uuid;
begin
  if _error_code is not null
     and exists (select 1 from public.bug_reports r where r.error_code = _error_code) then
    return 'duplicate';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('bug_report:' || coalesce(_user_id::text, 'ip:' || coalesce(_ip_hash, '')), 0)
  );

  if _user_id is not null then
    select count(*) into _recent
    from public.bug_reports r
    where r.user_id = _user_id and r.created_at > now() - interval '1 hour';
    if _recent >= _limit_user then
      return 'limited';
    end if;
  else
    select count(*) into _recent
    from public.bug_reports r
    where r.user_id is null and r.ip_hash = _ip_hash and r.created_at > now() - interval '1 hour';
    if _recent >= _limit_anonymous then
      return 'limited';
    end if;
  end if;

  insert into public.bug_reports (
    user_id, ip_hash, source, kind, page, error_code, description, error_message,
    error_digest, browser, device, viewport, locale, app_version
  ) values (
    _user_id, _ip_hash, _source, 'bug', _page, _error_code, nullif(btrim(_description), ''),
    _error_message, _error_digest, _browser, _device, _viewport, _locale, _app_version
  )
  on conflict (error_code) do nothing
  returning id into _id;

  return case when _id is null then 'duplicate' else 'created' end;
end;
$$;

revoke all on function public.bug_report_submit(uuid, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.bug_report_submit(uuid, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- The administration's list (server only)
-- -----------------------------------------------------------------------------

-- The newest reports. _code (an error code or its beginning, GR-…) finds a
-- report whoever sent it, internal accounts included; without it the list
-- leaves internal accounts out unless the view includes them.
create or replace function public.admin_bug_reports(
  _code text default null,
  _include_internal boolean default false,
  _limit integer default 50
)
returns table (
  id uuid,
  user_id uuid,
  source text,
  kind text,
  status text,
  description text,
  error_code text,
  error_message text,
  error_digest text,
  page text,
  browser text,
  device text,
  viewport text,
  locale text,
  app_version text,
  created_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _prefix text := nullif(btrim(coalesce(_code, '')), '');
begin
  if _prefix is not null and _prefix !~ '^GR-[A-Z0-9]{0,6}$' then
    return;
  end if;
  return query
  select
    r.id, r.user_id, r.source, r.kind, r.status, r.description, r.error_code, r.error_message,
    r.error_digest, r.page, r.browser, r.device, r.viewport, r.locale, r.app_version, r.created_at
  from public.bug_reports r
  left join public.profiles p on p.id = r.user_id
  where case
      when _prefix is not null then r.error_code like _prefix || '%'
      else coalesce(_include_internal, false) or not coalesce(p.is_internal, false)
    end
  order by r.created_at desc
  limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$$;

revoke all on function public.admin_bug_reports(text, boolean, integer) from public, anon, authenticated;
grant execute on function public.admin_bug_reports(text, boolean, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('bug_report_sent', 'platform', false);
