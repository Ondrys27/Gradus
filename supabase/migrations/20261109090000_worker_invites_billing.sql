-- =============================================================================
-- Invites by short id or e-mail, who pays for whom, AI spend by space (22.5)
--
--   * An invite may name an existing account (worker_invites.invitee_id): the
--     owner typed its short id or the e-mail of an account. Only the server
--     binds it (worker_invite_bind, service role, after the owner's own
--     client created the worker record and the invite). The person sees it in
--     the app (my_worker_invites), accepts or declines it there
--     (worker_invite_respond); the owner sees the state and gets a
--     notification. An invite without an account stays the code and link of
--     today: the registration takes it (accept_worker_invite).
--   * Leaving a company: space_leave() by the worker. The record ends like a
--     removal by the owner (status inactive, the people under them move up),
--     the membership says "left", the owner gets a notification.
--   * account_notifications: what the owner hears about their people
--     (accepted, declined, left). Written only by these functions; the
--     account reads its own and marks them read, nothing else.
--   * Who pays: a worker with a valid plan of their own is free for the
--     company; anyone else takes a seat of the owner's plan: included_workers
--     seats in the price, then per_worker (the price per extra worker) each.
--     Computed, never stored (worker_seats; the same rule as workerSeats() in
--     src/features/plan/worker-seats.ts). A worker account made from an
--     invite has beta only through the company (subscriptions.via_worker_invite):
--     that is no plan of their own.
--   * The catalog's plans may carry included_workers (older versions without
--     it read as 0); beta and the other plans outside it carry the same in
--     plans. A draft with the numbers agreed for workers is prepared when
--     there is no draft; the owner publishes it in the administration.
--   * AI spend by space: ai_usage.space_id is the space the call was made in
--     (the account's own one when nothing else is known). The administration
--     reads spend by space and by account (metric_ai_top_spaces).
--   * Jarvis: the rule suggestion "workerInvite" (an invite waits for you).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Invites for an existing account
-- -----------------------------------------------------------------------------

alter table public.worker_invites
  add column invitee_id uuid references auth.users (id) on delete cascade,
  add column declined_at timestamptz;

create index worker_invites_invitee_idx on public.worker_invites (invitee_id)
  where invitee_id is not null and accepted_at is null and declined_at is null;

-- As before, plus: the account an invite names and its answer are the server's.
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
  if new.code is distinct from old.code or new.expires_at is distinct from old.expires_at then
    raise exception 'invite_code_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- The account behind a short id or an e-mail, for the server only. An account
-- made only for the administration has no workspace and is nobody to invite.
create or replace function public.account_by_public_id(_public_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.space_id = p.id and m.role = 'owner'
  where p.public_id = upper(btrim(_public_id))
  limit 1;
$$;
revoke execute on function public.account_by_public_id(text) from public, anon, authenticated;
grant execute on function public.account_by_public_id(text) to service_role;

create or replace function public.account_by_email(_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join public.memberships m on m.user_id = u.id and m.space_id = u.id and m.role = 'owner'
  where lower(u.email) = lower(btrim(_email))
  limit 1;
$$;
revoke execute on function public.account_by_email(text) from public, anon, authenticated;
grant execute on function public.account_by_email(text) to service_role;

-- Binds an open invite of the owner to an existing account. Server only, with
-- the owner from the session. Answers 'bound', or why not: 'self' (the owner
-- themselves), 'already_member' (works there already or has an open invite
-- there), 'invalid' (no such open invite of this owner).
create or replace function public.worker_invite_bind(_owner uuid, _invite uuid, _invitee uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.worker_invites;
begin
  if _owner is null or _invite is null or _invitee is null then
    return 'invalid';
  end if;
  select * into _row from public.worker_invites i
  where i.id = _invite and i.owner_id = _owner
  for update;
  if not found or _row.accepted_at is not null or _row.declined_at is not null
     or _row.invitee_id is not null then
    return 'invalid';
  end if;
  if _invitee = _owner then
    return 'self';
  end if;
  if exists (
    select 1 from public.workers w
    where w.owner_id = _owner and w.user_id = _invitee and w.status <> 'inactive'
  ) or exists (
    select 1 from public.worker_invites i
    join public.workers w on w.id = i.worker_id and w.status = 'invited' and w.user_id is null
    where i.owner_id = _owner and i.invitee_id = _invitee and i.id <> _invite
      and i.accepted_at is null and i.declined_at is null and i.expires_at > now()
  ) then
    return 'already_member';
  end if;
  -- An invite in the app waits longer than a link sent by hand.
  update public.worker_invites
  set invitee_id = _invitee, expires_at = greatest(expires_at, now() + interval '30 days'), updated_at = now()
  where id = _invite;
  return 'bound';
end;
$$;
revoke execute on function public.worker_invite_bind(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_invite_bind(uuid, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- What the owner hears about their people
-- -----------------------------------------------------------------------------

create table public.account_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('invite_accepted', 'invite_declined', 'worker_left')),
  -- The owner's worker record it is about; the name is read from it, never copied.
  worker_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table public.account_notifications is
  'What an account hears about its company (an invite accepted or declined, a worker who left). Written only by the database; the account reads its own and marks them read.';
create index account_notifications_user_idx on public.account_notifications (user_id, created_at desc);

alter table public.account_notifications enable row level security;
create policy account_notifications_select_own on public.account_notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.account_notifications from anon;
revoke insert, update, delete on table public.account_notifications from authenticated;
grant select on table public.account_notifications to authenticated;
grant all on table public.account_notifications to service_role;

-- Marks every unread notification of the signed-in account read; the count.
create or replace function public.account_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _count integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  update public.account_notifications set read_at = now()
  where user_id = auth.uid() and read_at is null;
  get diagnostics _count = row_count;
  return _count;
end;
$$;
revoke execute on function public.account_notifications_read() from public, anon;
grant execute on function public.account_notifications_read() to authenticated;

-- -----------------------------------------------------------------------------
-- The invitee's side
-- -----------------------------------------------------------------------------

-- Open invites of the signed-in account: which company (name and logo, the
-- owner's name), as what (the job title the owner gave and the rights), the
-- rewards the owner set for this worker or for everybody, and until when.
-- Never another account's e-mail. A signed-in caller always gets their own;
-- only the server (no session: Jarvis's daily runs) names the account.
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
    and i.expires_at > now()
    and w.status = 'invited'
    and w.user_id is null
  order by i.created_at desc
  limit 20;
$$;
revoke execute on function public.my_worker_invites(uuid) from public, anon;
grant execute on function public.my_worker_invites(uuid) to authenticated, service_role;

-- Accepts or declines an open invite that names the signed-in account. Accept
-- binds the account to the worker record (active from now; an earlier record
-- of the account in that company lets go of it); decline ends the record. The
-- owner hears either. Answers the company's space.
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
     or _row.expires_at <= now() then
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

-- The signed-in worker leaves a company. The record ends as when the owner
-- removes somebody without a handover: the people under them move up to their
-- manager (not while the company is read-only), open invites go, the record
-- is inactive and the membership "left". Deals and tasks stay as they are,
-- for the owner to hand over. The owner hears it. Answers the worker record.
create or replace function public.space_leave(_space uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _worker public.workers;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _worker from public.workers w
  where w.owner_id = _space and w.user_id = _uid and w.status = 'active'
  for update;
  if not found then
    raise exception 'not_member' using errcode = 'no_data_found';
  end if;
  if not public.workspace_read_only(_space) then
    update public.workers w set manager_id = _worker.manager_id
    where w.owner_id = _space and w.manager_id = _worker.id;
  end if;
  delete from public.worker_invites i where i.worker_id = _worker.id and i.accepted_at is null;
  update public.workers w set status = 'inactive' where w.id = _worker.id;
  update public.memberships m set status = 'left', left_at = coalesce(m.left_at, now()), updated_at = now()
  where m.user_id = _uid and m.space_id = _space;
  insert into public.account_notifications (user_id, kind, worker_id)
  values (_space, 'worker_left', _worker.id);
  return _worker.id;
end;
$$;
revoke execute on function public.space_leave(uuid) from public, anon;
grant execute on function public.space_leave(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Who pays for a worker
-- -----------------------------------------------------------------------------

-- A worker account made from an invite holds beta only through the company.
alter table public.subscriptions
  add column via_worker_invite boolean not null default false;

-- Accounts registered from a worker invite so far: beta, and the invite was
-- taken right when the account was made.
update public.subscriptions s
set via_worker_invite = true
where s.plan_key = 'beta'
  and exists (
    select 1
    from public.worker_invites i
    join public.profiles p on p.id = i.accepted_by
    where i.accepted_by = s.user_id
      and i.accepted_at between p.created_at - interval '1 minute' and p.created_at + interval '10 minutes'
  );

-- Another plan is the account's own: the mark goes with any change of plan.
create or replace function public.subscriptions_worker_invite_mark()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan_key is distinct from old.plan_key
     and new.via_worker_invite is not distinct from old.via_worker_invite then
    new.via_worker_invite := false;
  end if;
  return new;
end;
$$;
revoke execute on function public.subscriptions_worker_invite_mark() from public, anon, authenticated;

create trigger subscriptions_worker_invite_mark
  before update on public.subscriptions
  for each row execute function public.subscriptions_worker_invite_mark();

-- The registration of a worker from an invite: beta, marked as the company's.
create or replace function public.grant_worker_plan(_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.subscriptions (user_id, plan_key, status, via_worker_invite)
  values (_user_id, 'beta', 'active', true)
  on conflict (user_id) do update set
    plan_key = 'beta',
    status = 'active',
    trial_ends_at = null,
    current_period_end = null,
    via_worker_invite = true,
    updated_at = now();
$$;
revoke execute on function public.grant_worker_plan(uuid) from public, anon, authenticated;
grant execute on function public.grant_worker_plan(uuid) to service_role;

-- Whether an account has a valid plan of its own: a subscription that has not
-- expired (a running trial counts), and not the beta it got from an invite.
create or replace function public.account_has_own_plan(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not s.via_worker_invite
      and not public.subscription_expired(s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end)
    from public.subscriptions s
    where s.user_id = _user_id
  ), false);
$$;
revoke execute on function public.account_has_own_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_has_own_plan(uuid) to service_role;

-- Workers of plans outside the catalog (beta and older keys).
alter table public.plans
  add column included_workers integer not null default 0
    constraint plans_included_workers_range check (included_workers between 0 and 1000000),
  add column per_worker jsonb
    constraint plans_per_worker_valid check (per_worker is null or public.plan_catalog_money_ok(per_worker));
update public.plans set per_worker = '{"CZK": 290, "EUR": 12}'::jsonb where key = 'beta' and per_worker is null;

-- The owner's people against the plan: every worker not ended, the oldest
-- first (so the seats in the price go to the earliest), with whether they
-- hold a plan of their own. An invite not yet accepted counts as without one.
-- The owner of the space or the server only.
create or replace function public.worker_seats(_owner uuid)
returns table (
  worker_id uuid,
  status public.worker_status,
  own_plan boolean,
  declined boolean,
  pending_account boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from _owner then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select
    w.id,
    w.status,
    w.status = 'active' and w.user_id is not null and public.account_has_own_plan(w.user_id),
    w.status = 'inactive' and w.user_id is null and exists (
      select 1 from public.worker_invites i where i.worker_id = w.id and i.declined_at is not null
    ),
    w.status = 'invited' and exists (
      select 1 from public.worker_invites i
      where i.worker_id = w.id and i.invitee_id is not null
        and i.accepted_at is null and i.declined_at is null and i.expires_at > now()
    )
  from public.workers w
  where w.owner_id = _owner
  order by w.created_at, w.id
  limit 2000;
end;
$$;
revoke execute on function public.worker_seats(uuid) from public, anon;
grant execute on function public.worker_seats(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The catalog: included_workers (whole number 0–1 000 000, optional in older versions)
-- -----------------------------------------------------------------------------

create or replace function public.plan_catalog_plan_ok(_p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not public.plan_catalog_keys_ok(_p, array[
      'key', 'name', 'tagline', 'monthly', 'yearly', 'per_worker', 'included_workers', 'limits',
      'features', 'recommended', 'order']) then false
    when not public.plan_catalog_keys_ok(_p -> 'limits', array[
      'daily_contacts', 'monthly_contacts', 'ai_calls', 'ai_files', 'workers', 'storage_mb']) then false
    when jsonb_typeof(_p -> 'features') is distinct from 'array' then false
    else coalesce(
      _p ->> 'key' in ('solo', 'pro', 'team')
      and public.plan_catalog_text_ok(_p -> 'name', 1, 40)
      and public.plan_catalog_text_ok(_p -> 'tagline', 0, 80)
      and public.plan_catalog_money_ok(_p -> 'monthly')
      and public.plan_catalog_money_ok(_p -> 'yearly')
      and public.plan_catalog_number(_p -> 'yearly' -> 'CZK')
        <= 12 * public.plan_catalog_number(_p -> 'monthly' -> 'CZK')
      and public.plan_catalog_number(_p -> 'yearly' -> 'EUR')
        <= 12 * public.plan_catalog_number(_p -> 'monthly' -> 'EUR')
      and (jsonb_typeof(_p -> 'per_worker') = 'null' or public.plan_catalog_money_ok(_p -> 'per_worker'))
      and (not (_p ? 'included_workers') or public.plan_catalog_count_ok(_p -> 'included_workers', false))
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'daily_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'monthly_contacts', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_calls', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'ai_files', false)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'workers', true)
      and public.plan_catalog_count_ok(_p -> 'limits' -> 'storage_mb', true)
      and jsonb_array_length(_p -> 'features') <= 12
      and (select coalesce(bool_and(public.plan_catalog_feature_ok(f)), true)
           from jsonb_array_elements(_p -> 'features') as f)
      and jsonb_typeof(_p -> 'recommended') = 'boolean'
      and public.plan_catalog_number(_p -> 'order') in (0, 1, 2),
      false)
  end;
$$;

-- The numbers agreed for workers, as a draft for the owner to publish (never
-- published from here): Solo none in the price and no extra ones, Pro none in
-- the price and the price per worker, Team 10 in the price and then the same
-- price each. Only when no draft exists; the prices stay the published ones.
insert into public.plan_catalog_versions (status, payload)
select 'draft', (
  select jsonb_agg(
    case e.p ->> 'key'
      when 'solo' then e.p || '{"included_workers": 0}'::jsonb
      when 'pro' then e.p || jsonb_build_object(
        'included_workers', 0,
        'per_worker', case
          when jsonb_typeof(e.p -> 'per_worker') = 'object' then e.p -> 'per_worker'
          else coalesce(t.price, 'null'::jsonb)
        end)
      else e.p || '{"included_workers": 10}'::jsonb
    end
    order by e.n)
  from jsonb_array_elements(v.payload) with ordinality as e(p, n)
)
from public.plan_catalog_versions v
cross join lateral (
  select nullif(x -> 'per_worker', 'null'::jsonb) as price
  from jsonb_array_elements(v.payload) x
  where x ->> 'key' = 'team'
  limit 1
) t
where v.status = 'published'
  and not exists (select 1 from public.plan_catalog_versions d where d.status = 'draft');

-- -----------------------------------------------------------------------------
-- AI spend by space
-- -----------------------------------------------------------------------------

alter table public.ai_usage add column space_id uuid;
create index ai_usage_space_created_idx on public.ai_usage (space_id, created_at desc);

-- Without a space given the call belongs to the account's own one.
create or replace function public.ai_usage_space_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.space_id := coalesce(new.space_id, new.user_id);
  return new;
end;
$$;
revoke execute on function public.ai_usage_space_default() from public, anon, authenticated;

create trigger ai_usage_space_default
  before insert on public.ai_usage
  for each row execute function public.ai_usage_space_default();

-- The spend of one space since an instant: every call made in it, by the
-- owner or anybody working there (older rows without a space are the
-- account's own).
create or replace function public.jarvis_space_month_spend(_space_id uuid, _since timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  where coalesce(u.space_id, u.user_id) = _space_id and u.created_at >= _since;
$$;
revoke all on function public.jarvis_space_month_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_space_month_spend(uuid, timestamptz) to service_role;

-- Answered calls of one account in one space since an instant (the plan's
-- monthly number of answers counts per person and space).
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
    and u.created_at >= _since;
$$;
revoke all on function public.jarvis_space_calls(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_space_calls(uuid, uuid, timestamptz) to service_role;

-- The ten spaces with the highest AI cost in the range: the space (its
-- owner), the owner's plan, how many accounts called there, calls and cost.
create or replace function public.metric_ai_top_spaces(
  _from date,
  _to date,
  _limit integer default 10,
  _tz text default 'Europe/Prague',
  _include_internal boolean default false,
  _segment jsonb default '{}'
)
returns table (space_id uuid, plan text, users bigint, calls bigint, cost_usd numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  _users uuid[];
begin
  perform public.metric_check_range(_from, _to);
  _users := public.metric_users(_tz, _include_internal, _segment);

  return query
  select coalesce(u.space_id, u.user_id), d.plan, count(distinct u.user_id), count(*), coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  join public.metric_user_dims(_tz) d on d.user_id = coalesce(u.space_id, u.user_id)
  where coalesce(u.space_id, u.user_id) = any(_users)
    and u.created_at >= public.metric_day_start(_from, _tz)
    and u.created_at < public.metric_day_start(_to + 1, _tz)
  group by coalesce(u.space_id, u.user_id), d.plan
  order by 5 desc, 4 desc
  limit greatest(1, least(coalesce(_limit, 10), 100));
end;
$$;
revoke all on function public.metric_ai_top_spaces(date, date, integer, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.metric_ai_top_spaces(date, date, integer, text, boolean, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Jarvis: "an invite waits for you" as a rule suggestion
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'overdueCrmTask', 'workerInvite', 'taskCompleted', 'insight', 'pathReady', 'briefing', 'question'
));

-- As in 20261104200000_jarvis_rules.sql, with 'workerInvite' among the types.
create or replace function public.valid_jarvis_rules(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when jsonb_typeof(_value -> 'suggestion_types') is distinct from 'object' then false
    else coalesce(
      (select count(*) = 7 and bool_and(k in (
         'suggestion_types', 'questions', 'min_gap_hours', 'questions_per_week',
         'suggestion_fresh_days', 'page_settle_seconds', 'instructions'))
       from jsonb_object_keys(_value) as k)
      and (select coalesce(bool_and(
             t.key in ('insight', 'stalledDeal', 'overdueTask', 'overdueInvoice',
                       'overdueCrmTask', 'milestoneReady', 'followUps', 'pathReady', 'workerInvite')
             and jsonb_typeof(t.value) = 'boolean'), true)
           from jsonb_each(_value -> 'suggestion_types') as t)
      and jsonb_typeof(_value -> 'questions') = 'boolean'
      and jsonb_typeof(_value -> 'min_gap_hours') = 'number'
      and jsonb_typeof(_value -> 'questions_per_week') = 'number'
      and jsonb_typeof(_value -> 'suggestion_fresh_days') = 'number'
      and jsonb_typeof(_value -> 'page_settle_seconds') = 'number'
      and (_value ->> 'min_gap_hours')::numeric between 2 and 72
      and (_value ->> 'min_gap_hours')::numeric = trunc((_value ->> 'min_gap_hours')::numeric)
      and (_value ->> 'questions_per_week')::numeric between 0 and 7
      and (_value ->> 'questions_per_week')::numeric = trunc((_value ->> 'questions_per_week')::numeric)
      and (_value ->> 'suggestion_fresh_days')::numeric between 1 and 30
      and (_value ->> 'suggestion_fresh_days')::numeric = trunc((_value ->> 'suggestion_fresh_days')::numeric)
      and (_value ->> 'page_settle_seconds')::numeric between 10 and 600
      and (_value ->> 'page_settle_seconds')::numeric = trunc((_value ->> 'page_settle_seconds')::numeric)
      and jsonb_typeof(_value -> 'instructions') = 'string'
      and char_length(_value ->> 'instructions') <= 2000,
      false
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------
insert into public.analytics_event_catalog (event, section, active) values
  ('worker_invite_declined', 'workers', false),
  ('space_left', 'account', false)
on conflict (event) do nothing;
