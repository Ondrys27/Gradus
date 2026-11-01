-- =============================================================================
-- Deleting an account (Settings → Account, step 12.5)
-- =============================================================================
-- The server deletes an account through Supabase Auth's admin API. Every row of
-- the account goes with it through the foreign keys to auth.users (on delete
-- cascade); rows that belong to other accounts only lose the link (on delete
-- set null: who created a deal, who called, who finished a task). These
-- functions do what the keys cannot: say what blocks the deletion, list the
-- account's files in storage, and keep the usage analytics without the person.
-- Only the server (service role) calls them, always with the user of the
-- session. Nothing here deletes a row; the deletion itself stays in Auth.

-- What stops the account from being deleted, as codes for the settings page:
--   app_owner       the one owner of the whole app (the administration needs one)
--   active_workers  an owner with active workers: deactivate them first, so
--                   nobody loses their place of work without knowing
create or replace function public.account_deletion_blockers(_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when exists (
      select 1 from public.user_roles r where r.user_id = _user and r.role = 'owner'
    ) then 'app_owner' end,
    case when exists (
      select 1 from public.workers w where w.owner_id = _user and w.status = 'active'
    ) then 'active_workers' end
  ], null);
$$;

-- The account's files: every bucket keeps a user's files in a top folder named
-- by their id (avatars, Jarvis and e-mail attachments, invoice PDFs of their
-- own workspace, bug report screenshots). The server removes them through the
-- Storage API before the account goes.
create or replace function public.account_storage_objects(_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.name like _user::text || '/%'
  order by o.bucket_id, o.name;
$$;

-- Right before the account is deleted: refuses a blocked account, keeps its
-- usage analytics without the person (user_id null; the workspace owner and
-- the session fall away with the keys), and leaves a worker's record in the
-- owner's team inactive, with its history, instead of looking still employed.
create or replace function public.account_prepare_deletion(_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _blockers text[] := public.account_deletion_blockers(_user);
begin
  if _user is null then
    raise exception 'account_missing' using errcode = 'P0002';
  end if;
  if cardinality(_blockers) > 0 then
    raise exception '%', _blockers[1] using errcode = 'P0001';
  end if;
  update public.analytics_events set user_id = null where user_id = _user;
  update public.workers set status = 'inactive' where user_id = _user and status <> 'inactive';
end;
$$;

revoke all on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function public.account_storage_objects(uuid) from public, anon, authenticated;
revoke all on function public.account_prepare_deletion(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;
grant execute on function public.account_storage_objects(uuid) to service_role;
grant execute on function public.account_prepare_deletion(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Analytics catalog
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('account_data_exported', 'account', false),
  ('account_deleted', 'account', false)
on conflict (event) do nothing;
