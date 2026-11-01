-- =============================================================================
-- Report a problem (step 12.4): the dialog's report, its console errors and
-- screenshot, the administration's list with filters and the status change.
--
--   * bug_reports gains console_errors (the last 20, scrubbed again by the
--     server), screenshot_path (object in the private bucket bug-screenshots)
--     and fixed_notified_at (the thank-you e-mail goes out once).
--   * A report from the dialog (source 'report') always has a description.
--   * bug_report_create(): the dialog's report, signed-in senders only, with
--     the per-account hourly limit; service role only (the server writes).
--   * Screenshots: private bucket, read by the author (first folder = their
--     id) and the owner; written only by the server.
--   * admin_bug_report_list() / admin_bug_report_set_status(): the
--     administration's list with filters, and the status change, which claims
--     the thank-you e-mail of a report that just became fixed. Service role only.
-- Only additive: the older bug_report_submit() and admin_bug_reports() stay.
-- =============================================================================

alter table public.bug_reports
  add column console_errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(console_errors) = 'array' and jsonb_array_length(console_errors) <= 20),
  add column screenshot_path text check (char_length(screenshot_path) <= 200),
  add column fixed_notified_at timestamptz;

alter table public.bug_reports
  add constraint bug_reports_report_has_description
  check (source <> 'report' or char_length(btrim(coalesce(description, ''))) > 0) not valid;

create index bug_reports_status_idx on public.bug_reports (status, created_at desc);

-- -----------------------------------------------------------------------------
-- Writing a report from the dialog (server only)
-- -----------------------------------------------------------------------------

-- Returns the new report's id, or null when the account has reached the hourly
-- limit. The advisory lock serialises one sender's parallel requests.
create or replace function public.bug_report_create(
  _user_id uuid,
  _kind text,
  _page text,
  _description text,
  _expected text default null,
  _console_errors jsonb default '[]'::jsonb,
  _browser text default null,
  _device text default null,
  _viewport text default null,
  _locale text default null,
  _app_version text default null,
  _limit_user integer default 20
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  _recent integer;
  _id uuid;
begin
  if _user_id is null then
    raise exception 'bug_report_create needs a signed-in sender';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bug_report:' || _user_id::text, 0));
  select count(*) into _recent
  from public.bug_reports r
  where r.user_id = _user_id and r.created_at > now() - interval '1 hour';
  if _recent >= _limit_user then
    return null;
  end if;
  insert into public.bug_reports (
    user_id, source, kind, page, description, expected, console_errors,
    browser, device, viewport, locale, app_version
  ) values (
    _user_id, 'report', _kind, _page, btrim(_description), nullif(btrim(coalesce(_expected, '')), ''),
    coalesce(_console_errors, '[]'::jsonb), _browser, _device, _viewport, _locale, _app_version
  )
  returning id into _id;
  return _id;
end;
$$;

revoke all on function public.bug_report_create(uuid, text, text, text, text, jsonb, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.bug_report_create(uuid, text, text, text, text, jsonb, text, text, text, text, text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Screenshots
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-screenshots', 'bug-screenshots', false, 1572864, array['image/jpeg'])
on conflict (id) do nothing;

-- The first folder is the author's id. Only the author and the owner read;
-- nobody writes from the browser (the server uploads after checking the image).
create policy "bug_screenshots_select_author_or_owner" on storage.objects for select to authenticated
  using (
    bucket_id = 'bug-screenshots'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'owner')
    )
  );

-- -----------------------------------------------------------------------------
-- The administration (server only)
-- -----------------------------------------------------------------------------

create or replace function public.admin_bug_report_list(
  _status text default null,
  _kind text default null,
  _source text default null,
  _include_internal boolean default false,
  _limit integer default 100,
  _id uuid default null,
  _code text default null
)
returns table (
  id uuid,
  user_id uuid,
  source text,
  kind text,
  status text,
  description text,
  expected text,
  error_code text,
  error_message text,
  error_digest text,
  page text,
  browser text,
  device text,
  viewport text,
  locale text,
  app_version text,
  console_errors jsonb,
  screenshot_path text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _prefix text := nullif(btrim(coalesce(_code, '')), '');
begin
  -- An error code (or its beginning) finds a report whoever sent it, like admin_bug_reports().
  if _prefix is not null and _prefix !~ '^GR-[A-Z0-9]{0,6}$' then
    return;
  end if;
  return query
  select
    r.id, r.user_id, r.source, r.kind, r.status, r.description, r.expected, r.error_code,
    r.error_message, r.error_digest, r.page, r.browser, r.device, r.viewport, r.locale,
    r.app_version, r.console_errors, r.screenshot_path, r.created_at, r.updated_at
  from public.bug_reports r
  left join public.profiles p on p.id = r.user_id
  where (_id is null or r.id = _id)
    and (_prefix is null or r.error_code like _prefix || '%')
    and (_status is null or r.status = _status)
    and (_kind is null or r.kind = _kind)
    and (_source is null or r.source = _source)
    and (_id is not null or _prefix is not null or coalesce(_include_internal, false)
         or not coalesce(p.is_internal, false))
  order by r.created_at desc
  limit greatest(1, least(coalesce(_limit, 100), 200));
end;
$$;

revoke all on function public.admin_bug_report_list(text, text, text, boolean, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_bug_report_list(text, text, text, boolean, integer, uuid, text) to service_role;

-- Changes the status. Returns the author to thank when the report just became
-- fixed for the first time (the claim is made here, so the e-mail goes once),
-- otherwise null; raises when the report or the status is unknown.
create or replace function public.admin_bug_report_set_status(_id uuid, _status text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  _author uuid;
  _notified timestamptz;
begin
  if _status not in ('new', 'in_progress', 'fixed', 'cannot_reproduce') then
    raise exception 'unknown status';
  end if;
  update public.bug_reports
     set status = _status, updated_at = now()
   where id = _id
  returning user_id, fixed_notified_at into _author, _notified;
  if not found then
    raise exception 'unknown report';
  end if;
  if _status = 'fixed' and _author is not null and _notified is null then
    update public.bug_reports set fixed_notified_at = now() where id = _id;
    return _author;
  end if;
  return null;
end;
$$;

revoke all on function public.admin_bug_report_set_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_bug_report_set_status(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('bug_report_opened', 'platform', false),
  ('bug_report_status_changed', 'platform', false),
  ('welcome_email_sent', 'platform', false)
on conflict (event) do nothing;
