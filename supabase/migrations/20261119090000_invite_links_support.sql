-- =============================================================================
-- Worker invite links that say why they no longer work, and the support form
-- (step 27.1)
--
--   * Opening an invite link never uses it up: only a finished registration
--     (accept_worker_invite) or an acceptance in the app does. Both now also
--     refuse an invite that was replaced or declined, and the registration
--     one an invite already waiting for an existing account.
--   * A new invite to the same e-mail replaces the owner's older open ones
--     (worker_invites.replaced_at / replaced_by, written only by the
--     database): the older link says "replaced", the record it was for ends
--     (inactive, nobody's seat any more) and the owner sees why.
--   * An invite deleted before anybody used it (the owner removed the person,
--     renewed the link, deleted the record) leaves a tombstone with its code
--     (worker_invite_tombstones, server only), so the link can say "revoked
--     by the owner" or "replaced" instead of "unknown".
--   * worker_invite_respond_code(): the signed-in account opened a link meant
--     for it (the e-mail of the invite is its own, or the invite names it)
--     and accepts or declines there; an invite naming nobody's e-mail can be
--     accepted by whoever holds the code, like the registration.
--   * worker_invite_request_new(): "Ask for a new one" on a link that no
--     longer works. The owner gets a notification (invite_requested), at most
--     one a day per invite. Server only.
--   * bug_reports: source 'support' for the public /podpora form, signed in
--     or not, with an optional e-mail to answer to (contact_email);
--     bug_report_support() writes it with the per-account and per-address
--     hourly limits. Server only.
-- Only additive: two check constraints widen, nothing else changes type.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Replaced invites
-- -----------------------------------------------------------------------------

alter table public.worker_invites
  add column replaced_at timestamptz,
  add column replaced_by uuid references public.worker_invites (id) on delete set null;

comment on column public.worker_invites.replaced_at is
  'When a newer invite of the same owner to the same e-mail replaced this one. Written only by the database.';

-- As before, plus: the replacement is the database's.
create or replace function public.worker_invites_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.accepted_at is not null or new.accepted_by is not null then
      raise exception 'invite_acceptance_is_server_only' using errcode = 'insufficient_privilege';
    end if;
    if new.invitee_id is not null or new.declined_at is not null then
      raise exception 'invite_account_is_server_only' using errcode = 'insufficient_privilege';
    end if;
    if new.replaced_at is not null or new.replaced_by is not null then
      raise exception 'invite_replacement_is_server_only' using errcode = 'insufficient_privilege';
    end if;
    new.code := public.new_invite_code();
    new.expires_at := now() + interval '7 days';
    return new;
  end if;
  if new.accepted_at is distinct from old.accepted_at
     or new.accepted_by is distinct from old.accepted_by then
    raise exception 'invite_acceptance_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  if new.invitee_id is distinct from old.invitee_id or new.declined_at is distinct from old.declined_at then
    raise exception 'invite_account_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  if new.replaced_at is distinct from old.replaced_at or new.replaced_by is distinct from old.replaced_by then
    raise exception 'invite_replacement_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  if new.code is distinct from old.code or new.expires_at is distinct from old.expires_at then
    raise exception 'invite_code_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- A new invite to an e-mail replaces the owner's older open invites to it.
-- The record an older one was for (another, never joined) ends, and the
-- people under it move up to its manager, as when the owner removes someone.
create or replace function public.worker_invites_supersede()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old record;
  _manager uuid;
begin
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;
  for _old in
    select i.id, i.worker_id
    from public.worker_invites i
    where i.owner_id = new.owner_id
      and i.id <> new.id
      and i.email is not null
      and lower(btrim(i.email)) = lower(btrim(new.email))
      and i.accepted_at is null
      and i.declined_at is null
      and i.replaced_at is null
    for update
  loop
    update public.worker_invites
    set replaced_at = now(), replaced_by = new.id, updated_at = now()
    where id = _old.id;
    if _old.worker_id <> new.worker_id then
      update public.workers w set status = 'inactive'
      where w.id = _old.worker_id and w.owner_id = new.owner_id
        and w.status = 'invited' and w.user_id is null
      returning w.manager_id into _manager;
      if found then
        update public.workers w set manager_id = _manager
        where w.owner_id = new.owner_id and w.manager_id = _old.worker_id;
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.worker_invites_supersede() from public, anon, authenticated;

create trigger worker_invites_supersede
  after insert on public.worker_invites
  for each row execute function public.worker_invites_supersede();

-- -----------------------------------------------------------------------------
-- Tombstones of invites deleted unused
-- -----------------------------------------------------------------------------

create table public.worker_invite_tombstones (
  code text primary key,
  -- Plain ids, no foreign keys: an account deletion cascading through its
  -- invites must never fail on its own tombstones.
  owner_id uuid not null,
  worker_id uuid,
  reason text not null check (reason in ('revoked', 'replaced')),
  expires_at timestamptz not null,
  ended_at timestamptz not null default now()
);
comment on table public.worker_invite_tombstones is
  'The code of a worker invite deleted before anybody used it, with why (revoked by the owner or replaced by a newer one), so the link can say so. Server only.';
create index worker_invite_tombstones_owner_idx on public.worker_invite_tombstones (owner_id);

alter table public.worker_invite_tombstones enable row level security;
revoke all on table public.worker_invite_tombstones from anon, authenticated;
grant all on table public.worker_invite_tombstones to service_role;

create or replace function public.worker_invites_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.accepted_at is null and old.declined_at is null then
    insert into public.worker_invite_tombstones (code, owner_id, worker_id, reason, expires_at)
    values (
      old.code,
      old.owner_id,
      old.worker_id,
      case
        when old.replaced_at is not null then 'replaced'
        when exists (
          select 1 from public.worker_invites i
          where i.worker_id = old.worker_id and i.id <> old.id and i.accepted_at is null
            and i.created_at >= old.created_at
        ) then 'replaced'
        else 'revoked'
      end,
      old.expires_at
    )
    on conflict (code) do nothing;
  end if;
  return old;
end;
$$;
revoke execute on function public.worker_invites_tombstone() from public, anon, authenticated;

create trigger worker_invites_tombstone
  after delete on public.worker_invites
  for each row execute function public.worker_invites_tombstone();

-- -----------------------------------------------------------------------------
-- The registration takes only an invite that is really open
-- -----------------------------------------------------------------------------

-- As before, plus: not declined, not replaced, not waiting for an existing
-- account, and the record still invited.
create or replace function public.accept_worker_invite(_code text, _user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _invite public.worker_invites;
begin
  select * into _invite from public.worker_invites where code = _code for update;
  if _invite.id is null or _invite.accepted_at is not null or _invite.expires_at < now()
     or _invite.declined_at is not null or _invite.replaced_at is not null
     or _invite.invitee_id is not null then
    raise exception 'invite_invalid' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.workers where user_id = _user_id) then
    raise exception 'already_worker' using errcode = 'check_violation';
  end if;

  update public.workers
  set user_id = _user_id, status = 'active'
  where id = _invite.worker_id and user_id is null and status = 'invited';
  if not found then
    raise exception 'invite_invalid' using errcode = 'check_violation';
  end if;

  update public.worker_invites
  set accepted_at = now(), accepted_by = _user_id
  where id = _invite.id;
  return _invite.worker_id;
end;
$$;
revoke execute on function public.accept_worker_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_worker_invite(text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The invitee's own list and answer leave replaced invites out
-- -----------------------------------------------------------------------------

-- As in 22.5, plus: not replaced by a newer invite.
create or replace function public.my_worker_invites(_user uuid default null)
returns table (
  invite_id uuid,
  space_id uuid,
  company_name text,
  logo_url text,
  owner_name text,
  job_title text,
  grants jsonb,
  rewards jsonb,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.owner_id,
    coalesce(p.company_name, ip.name),
    p.company_logo_url,
    p.display_name,
    w.job_title,
    coalesce((
      select jsonb_agg(jsonb_build_object('section', g.section, 'action', g.action, 'allowed', g.allowed)
                       order by g.section, g.action)
      from public.worker_permission_grants g
      where g.worker_id = w.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'worker_id', r.worker_id, 'rules', r.rules)
                       order by r.created_at)
      from public.reward_rules r
      where r.owner_id = i.owner_id and r.is_active and (r.worker_id is null or r.worker_id = w.id)
    ), '[]'::jsonb),
    i.expires_at,
    i.created_at
  from public.worker_invites i
  join public.workers w on w.id = i.worker_id and w.owner_id = i.owner_id
  left join public.profiles p on p.id = i.owner_id
  left join public.invoice_profiles ip on ip.user_id = i.owner_id
  where i.invitee_id = coalesce(auth.uid(), _user)
    and i.accepted_at is null
    and i.declined_at is null
    and i.replaced_at is null
    and i.expires_at > now()
    and w.status = 'invited'
    and w.user_id is null
  order by i.created_at desc
  limit 20;
$$;
revoke execute on function public.my_worker_invites(uuid) from public, anon;
grant execute on function public.my_worker_invites(uuid) to authenticated, service_role;

-- As in 22.5, plus: a replaced invite can not be answered.
create or replace function public.worker_invite_respond(_invite uuid, _accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _row public.worker_invites;
  _worker public.workers;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _row from public.worker_invites i
  where i.id = _invite and i.invitee_id = _uid
  for update;
  if not found or _row.accepted_at is not null or _row.declined_at is not null
     or _row.replaced_at is not null or _row.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'check_violation';
  end if;
  select * into _worker from public.workers w
  where w.id = _row.worker_id and w.owner_id = _row.owner_id
  for update;
  if not found or _worker.user_id is not null or _worker.status <> 'invited' then
    raise exception 'invite_invalid' using errcode = 'check_violation';
  end if;

  if coalesce(_accept, false) then
    if exists (
      select 1 from public.workers w
      where w.owner_id = _row.owner_id and w.user_id = _uid and w.status <> 'inactive'
    ) then
      raise exception 'already_member' using errcode = 'check_violation';
    end if;
    -- One record per account and company: an ended one keeps its history but not the account.
    update public.workers w set user_id = null
    where w.owner_id = _row.owner_id and w.user_id = _uid and w.status = 'inactive';
    update public.workers w set user_id = _uid, status = 'active'
    where w.id = _worker.id;
    update public.worker_invites set accepted_at = now(), accepted_by = _uid, updated_at = now()
    where id = _row.id;
    insert into public.account_notifications (user_id, kind, worker_id)
    values (_row.owner_id, 'invite_accepted', _worker.id);
  else
    update public.worker_invites set declined_at = now(), updated_at = now()
    where id = _row.id;
    update public.workers w set status = 'inactive' where w.id = _worker.id;
    insert into public.account_notifications (user_id, kind, worker_id)
    values (_row.owner_id, 'invite_declined', _worker.id);
  end if;
  return _row.owner_id;
end;
$$;
revoke execute on function public.worker_invite_respond(uuid, boolean) from public, anon;
grant execute on function public.worker_invite_respond(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Accepting from the link while signed in
-- -----------------------------------------------------------------------------

-- The signed-in account answers the invite of a link. It must be meant for
-- it: the invite names it, or the invite's e-mail is its own; an invite with
-- no e-mail and no account named may only be accepted (by whoever holds the
-- code, like the registration). The owner never joins their own company.
-- The invite is bound to the account and answered as in the app
-- (worker_invite_respond), all or nothing. Answers the company's space.
create or replace function public.worker_invite_respond_code(_code text, _accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _email text;
  _row public.worker_invites;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select lower(btrim(u.email)) into _email from auth.users u where u.id = _uid;
  select * into _row from public.worker_invites i where i.code = btrim(coalesce(_code, '')) for update;
  if not found or _row.accepted_at is not null or _row.declined_at is not null
     or _row.replaced_at is not null or _row.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = 'check_violation';
  end if;
  if _row.owner_id = _uid then
    raise exception 'invite_self' using errcode = 'check_violation';
  end if;
  if _row.invitee_id is not null and _row.invitee_id <> _uid then
    raise exception 'invite_other_account' using errcode = 'check_violation';
  end if;
  if _row.invitee_id is null and _row.email is not null
     and lower(btrim(_row.email)) is distinct from _email then
    raise exception 'invite_other_account' using errcode = 'check_violation';
  end if;
  if not coalesce(_accept, false) and _row.invitee_id is null and _row.email is null then
    raise exception 'invite_other_account' using errcode = 'check_violation';
  end if;
  if _row.invitee_id is null then
    update public.worker_invites set invitee_id = _uid, updated_at = now() where id = _row.id;
  end if;
  return public.worker_invite_respond(_row.id, coalesce(_accept, false));
end;
$$;
revoke execute on function public.worker_invite_respond_code(text, boolean) from public, anon;
grant execute on function public.worker_invite_respond_code(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- "Ask for a new one"
-- -----------------------------------------------------------------------------

alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check
  check (kind in ('invite_accepted', 'invite_declined', 'worker_left', 'invite_requested'));

-- The person behind a link that no longer works asks the owner for a new
-- one. Answers 'sent', 'already' (asked within a day, or the owner has
-- heard ten such requests in the last hour) or 'unknown' (no such code).
-- Server only; the code is the only proof, nothing about the owner comes back.
create or replace function public.worker_invite_request_new(_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clean text := btrim(coalesce(_code, ''));
  _owner uuid;
  _worker uuid;
begin
  if _clean = '' then
    return 'unknown';
  end if;
  select i.owner_id, i.worker_id into _owner, _worker
  from public.worker_invites i where i.code = _clean;
  if _owner is null then
    select t.owner_id, t.worker_id into _owner, _worker
    from public.worker_invite_tombstones t where t.code = _clean;
  end if;
  if _owner is null or not exists (select 1 from auth.users u where u.id = _owner) then
    return 'unknown';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invite_request:' || _owner::text, 0));
  if exists (
    select 1 from public.account_notifications n
    where n.user_id = _owner and n.kind = 'invite_requested'
      and n.worker_id is not distinct from _worker and n.created_at > now() - interval '1 day'
  ) or (
    select count(*) from public.account_notifications n
    where n.user_id = _owner and n.kind = 'invite_requested' and n.created_at > now() - interval '1 hour'
  ) >= 10 then
    return 'already';
  end if;
  insert into public.account_notifications (user_id, kind, worker_id)
  values (_owner, 'invite_requested', _worker);
  return 'sent';
end;
$$;
revoke execute on function public.worker_invite_request_new(text) from public, anon, authenticated;
grant execute on function public.worker_invite_request_new(text) to service_role;

-- -----------------------------------------------------------------------------
-- The support form (/podpora)
-- -----------------------------------------------------------------------------

alter table public.bug_reports drop constraint bug_reports_source_check;
alter table public.bug_reports add constraint bug_reports_source_check
  check (source in ('report', 'error_page', 'support'));

alter table public.bug_reports
  add column contact_email text
    check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

comment on column public.bug_reports.contact_email is
  'The e-mail a support request (source support) asks to be answered at; only the server writes it, only the administration reads it.';

-- A support request, signed in or not. Returns the new report's id, or null
-- when the account (20 an hour) or, signed out, the address (5 an hour) has
-- reached its limit.
create or replace function public.bug_report_support(
  _user_id uuid,
  _ip_hash text,
  _kind text,
  _page text,
  _description text,
  _expected text default null,
  _contact_email text default null,
  _browser text default null,
  _device text default null,
  _viewport text default null,
  _locale text default null,
  _app_version text default null,
  _limit_user integer default 20,
  _limit_anonymous integer default 5
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  _recent integer;
  _id uuid;
begin
  if char_length(btrim(coalesce(_description, ''))) = 0 then
    raise exception 'bug_report_support needs a description';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('bug_report:' || coalesce(_user_id::text, 'ip:' || coalesce(_ip_hash, '')), 0)
  );
  if _user_id is not null then
    select count(*) into _recent
    from public.bug_reports r
    where r.user_id = _user_id and r.created_at > now() - interval '1 hour';
    if _recent >= _limit_user then
      return null;
    end if;
  else
    select count(*) into _recent
    from public.bug_reports r
    where r.user_id is null and r.ip_hash = _ip_hash and r.created_at > now() - interval '1 hour';
    if _recent >= _limit_anonymous then
      return null;
    end if;
  end if;
  insert into public.bug_reports (
    user_id, ip_hash, source, kind, page, description, expected, contact_email,
    browser, device, viewport, locale, app_version
  ) values (
    _user_id, _ip_hash, 'support', _kind, _page, btrim(_description),
    nullif(btrim(coalesce(_expected, '')), ''), nullif(lower(btrim(coalesce(_contact_email, ''))), ''),
    _browser, _device, _viewport, _locale, _app_version
  )
  returning id into _id;
  return _id;
end;
$$;
revoke all on function public.bug_report_support(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.bug_report_support(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog (src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('worker_invite_link_opened', 'workers', false),
  ('worker_invite_new_requested', 'workers', false)
on conflict (event) do nothing;
