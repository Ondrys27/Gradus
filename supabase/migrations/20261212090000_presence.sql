-- =============================================================================
-- 30.5 Online status in the company
--
-- Who is online is Supabase Realtime Presence on a private channel per space
-- (`presence:<space>`): only members of the space with "show when I am
-- online" on may join it (policies on realtime.messages). What stays is one
-- moment per account, when it last had the app open (presence_last_seen):
-- never a history, never a report. It lives in its own table and not in
-- profiles, whose rows the owner reads for every worker they ever had, so
-- nobody outside the company (a former worker's old employer) can read it.
--
-- Who turns the switch off is seen by nobody (the owner neither), sees
-- nobody, and their stored moment is gone at once.
-- =============================================================================

alter table public.user_settings
  add column if not exists show_online boolean not null default true;

comment on column public.user_settings.show_online is
  'Show the others in the company when I am online (30.5). Off: nobody sees my status and I see nobody''s.';

-- -----------------------------------------------------------------------------
-- The last moment an account had the app open
-- -----------------------------------------------------------------------------

create table if not exists public.presence_last_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

comment on table public.presence_last_seen is
  'When an account last had the app open (30.5): one row, overwritten; no history. Written only by presence_touch(), read only through presence_people().';

alter table public.presence_last_seen enable row level security;
-- No policies and no grants: the client reads and writes nothing directly.
revoke all on public.presence_last_seen from public, anon, authenticated;
grant all on public.presence_last_seen to service_role;

-- Whether an account shows its status (and so sees the others'); on unless
-- turned off.
create or replace function public.presence_shown(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _user is not null
    and coalesce((select us.show_online from public.user_settings us where us.user_id = _user), true);
$$;
revoke execute on function public.presence_shown(uuid) from public, anon, authenticated;
grant execute on function public.presence_shown(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Writing the moment: at most once a minute, and when leaving (the tab is
-- hidden or closed) at most every few seconds. Nothing for an account that
-- does not show its status.
-- -----------------------------------------------------------------------------

create or replace function public.presence_touch(_leaving boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _gap interval := case when coalesce(_leaving, false) then interval '5 seconds' else interval '55 seconds' end;
begin
  if _uid is null or not public.presence_shown(_uid) then
    return;
  end if;
  insert into public.presence_last_seen as ls (user_id, last_seen_at)
  values (_uid, now())
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at
    where ls.last_seen_at < now() - _gap;
end;
$$;
revoke execute on function public.presence_touch(boolean) from public, anon;
grant execute on function public.presence_touch(boolean) to authenticated;

-- Turning the switch off forgets the stored moment at once.
create or replace function public.user_settings_presence_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.show_online is distinct from true then
    delete from public.presence_last_seen ls where ls.user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.user_settings_presence_forget() from public, anon, authenticated;

drop trigger if exists user_settings_presence_forget on public.user_settings;
create trigger user_settings_presence_forget
  after insert or update of show_online on public.user_settings
  for each row execute function public.user_settings_presence_forget();

-- -----------------------------------------------------------------------------
-- Reading: the people of every space the account belongs to (its own and the
-- companies it actively works for), with their last moment. Only people who
-- show their status, and nothing at all for an account that does not.
-- -----------------------------------------------------------------------------

create or replace function public.presence_people()
returns table (space_id uuid, user_id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with spaces as (
    select auth.uid() as space_id
    where auth.uid() is not null
    union
    select m.space_id
    from public.memberships m
    where m.user_id = auth.uid()
      and m.role = 'worker'
      and m.status = 'active'
  ),
  people as (
    select s.space_id, s.space_id as user_id
    from spaces s
    union
    select m.space_id, m.user_id
    from public.memberships m
    join spaces s on s.space_id = m.space_id
    join public.workers w
      on w.id = m.worker_id and w.owner_id = m.space_id and w.user_id = m.user_id and w.status = 'active'
    where m.role = 'worker'
      and m.status = 'active'
  )
  select p.space_id, p.user_id, ls.last_seen_at
  from people p
  left join public.presence_last_seen ls on ls.user_id = p.user_id
  where public.presence_shown(auth.uid())
    and public.presence_shown(p.user_id)
  order by p.space_id, p.user_id
  limit 2000;
$$;
revoke execute on function public.presence_people() from public, anon;
grant execute on function public.presence_people() to authenticated;

comment on function public.presence_people() is
  'The people of the caller''s spaces who show their online status, with when they last had the app open (30.5). Empty when the caller does not show theirs.';

-- -----------------------------------------------------------------------------
-- The private channel presence:<space>: only members who show their status
-- may be present there and hear who else is.
-- -----------------------------------------------------------------------------

create or replace function public.presence_topic_allowed(_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _space uuid;
begin
  if auth.uid() is null or _topic is null
    or _topic !~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  _space := substring(_topic from 10)::uuid;
  return public.is_space_member(_space) and public.presence_shown(auth.uid());
end;
$$;
revoke execute on function public.presence_topic_allowed(text) from public, anon;
grant execute on function public.presence_topic_allowed(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists presence_space_receive on realtime.messages';
    execute $p$
      create policy presence_space_receive on realtime.messages for select to authenticated
      using (
        realtime.messages.extension = 'presence'
        and public.presence_topic_allowed((select realtime.topic()))
      )
    $p$;
    execute 'drop policy if exists presence_space_send on realtime.messages';
    execute $p$
      create policy presence_space_send on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension = 'presence'
        and public.presence_topic_allowed((select realtime.topic()))
      )
    $p$;
  end if;
end;
$$;
