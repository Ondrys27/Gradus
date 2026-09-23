-- =============================================================================
-- Security hardening (audit 2026-09-23)
--   * anon cannot execute anything in public; has_role is no longer a public oracle
--   * contact membership, the prospecting timer and work sessions change only
--     through their functions (no direct client writes, no reset)
--   * every reference to another row must point at a row of the same user
--   * columns the server or the owner controls cannot be set by the client
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

-- Postgres grants EXECUTE to PUBLIC by default; the app never calls the database
-- before sign-in, so anon gets nothing. authenticated keeps its explicit grant.
revoke execute on all functions in schema public from public, anon;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Server-only functions stay closed (the grant above must not reopen them).
revoke execute on function public.initialize_user(uuid, text), public.handle_new_user() from authenticated;

-- True for requests made with a user's or the anon key; false for the service
-- role and for SECURITY DEFINER functions. Must stay SECURITY INVOKER.
create or replace function public.is_client_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- -----------------------------------------------------------------------------
-- Contact membership: only move_contact() and the won-deal trigger write it
-- -----------------------------------------------------------------------------

drop policy "contact_table_entries_insert_own" on public.contact_table_entries;
drop policy "contact_table_entries_update_own" on public.contact_table_entries;
drop policy "contact_table_entries_delete_own" on public.contact_table_entries;
drop policy "contact_table_moves_insert_own" on public.contact_table_moves;

alter function public.move_contact(uuid, uuid, jsonb) security definer;
alter function public.deals_after_won() security definer;

-- System tables keep their identity: the timer and the clients table rely on it.
create or replace function public.contact_tables_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and (new.is_system or new.system_key is not null) then
    raise exception 'system_table_readonly' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.is_system is distinct from old.is_system
                           or new.system_key is distinct from old.system_key) then
    raise exception 'system_table_readonly' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'system_table_readonly' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger contact_tables_guard
  before insert or update or delete on public.contact_tables
  for each row execute function public.contact_tables_guard();

-- -----------------------------------------------------------------------------
-- Prospecting timer: start / pause only, no direct writes, no reset
-- -----------------------------------------------------------------------------

drop policy "prospecting_segments_insert_own" on public.prospecting_segments;
drop policy "prospecting_segments_update_own" on public.prospecting_segments;
drop policy "prospecting_segments_delete_own" on public.prospecting_segments;

create or replace function public.start_prospecting()
returns public.prospecting_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into _open from public.prospecting_segments
  where user_id = _uid and ended_at is null;

  if _open.id is not null then
    _effective := public.prospecting_effective_end(_open);
    if _effective < now() then
      update public.prospecting_segments
      set ended_at = _effective, end_reason = 'idle'
      where id = _open.id;
    else
      return _open;
    end if;
  end if;

  insert into public.prospecting_segments (user_id) values (_uid)
  returning * into _open;
  return _open;
end;
$$;

create or replace function public.pause_prospecting()
returns public.prospecting_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  _open public.prospecting_segments;
  _effective timestamptz;
begin
  select * into _open from public.prospecting_segments
  where user_id = auth.uid() and ended_at is null;
  if _open.id is null then
    return null;
  end if;

  _effective := public.prospecting_effective_end(_open);
  update public.prospecting_segments
  set ended_at = _effective,
      end_reason = case when _effective < now() then 'idle' else 'pause' end::public.session_end_reason
  where id = _open.id
  returning * into _open;
  return _open;
end;
$$;

-- -----------------------------------------------------------------------------
-- Work sessions: the worker starts and pauses, nobody writes times directly
-- -----------------------------------------------------------------------------

drop policy "work_sessions_owner_all" on public.work_sessions;
drop policy "work_sessions_worker_insert" on public.work_sessions;
drop policy "work_sessions_worker_update" on public.work_sessions;
create policy "work_sessions_owner_select" on public.work_sessions for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.start_work_session(_worker_id uuid)
returns public.work_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
  _open public.work_sessions;
  _effective timestamptz;
begin
  select owner_id into _owner from public.workers
  where id = _worker_id and user_id = auth.uid() and status = 'active';
  if _owner is null then
    raise exception 'worker_not_found' using errcode = 'no_data_found';
  end if;

  select * into _open from public.work_sessions
  where worker_id = _worker_id and ended_at is null;

  if _open.id is not null then
    _effective := public.work_session_effective_end(_open);
    if _effective < now() then
      update public.work_sessions
      set ended_at = _effective, end_reason = 'idle'
      where id = _open.id;
    else
      return _open;
    end if;
  end if;

  insert into public.work_sessions (owner_id, worker_id) values (_owner, _worker_id)
  returning * into _open;
  return _open;
end;
$$;

create or replace function public.pause_work_session(_worker_id uuid)
returns public.work_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  _open public.work_sessions;
  _effective timestamptz;
begin
  select s.* into _open from public.work_sessions s
  join public.workers w on w.id = s.worker_id
  where s.worker_id = _worker_id and w.user_id = auth.uid() and s.ended_at is null;
  if _open.id is null then
    return null;
  end if;

  _effective := public.work_session_effective_end(_open);
  update public.work_sessions
  set ended_at = _effective,
      end_reason = case when _effective < now() then 'idle' else 'pause' end::public.session_end_reason
  where id = _open.id
  returning * into _open;
  return _open;
end;
$$;

revoke execute on function public.start_work_session(uuid), public.pause_work_session(uuid) from public, anon;
grant execute on function public.start_work_session(uuid), public.pause_work_session(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Workers: the account link and invite acceptance belong to the server
-- -----------------------------------------------------------------------------

create or replace function public.workers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    raise exception 'worker_account_link_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger workers_guard
  before insert or update of user_id on public.workers
  for each row execute function public.workers_guard();

create or replace function public.worker_invites_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request() and (
       (tg_op = 'INSERT' and (new.accepted_at is not null or new.accepted_by is not null))
       or (tg_op = 'UPDATE' and (new.accepted_at is distinct from old.accepted_at
                                 or new.accepted_by is distinct from old.accepted_by))
     ) then
    raise exception 'invite_acceptance_is_server_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger worker_invites_guard
  before insert or update on public.worker_invites
  for each row execute function public.worker_invites_guard();

-- A worker may only move their task through its statuses.
create or replace function public.worker_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and auth.uid() is distinct from old.owner_id
     and (to_jsonb(new) - array['status', 'completed_at', 'updated_at'])
         <> (to_jsonb(old) - array['status', 'completed_at', 'updated_at']) then
    raise exception 'worker_may_only_change_status' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger worker_tasks_guard
  before update on public.worker_tasks
  for each row execute function public.worker_tasks_guard();

-- -----------------------------------------------------------------------------
-- Feature requests: status and the admin note are for owner and admin
-- -----------------------------------------------------------------------------

drop policy "feature_requests_update" on public.feature_requests;
create policy "feature_requests_update" on public.feature_requests for update to authenticated
  using ((select auth.uid()) = user_id or public.has_role((select auth.uid()), 'owner') or public.has_role((select auth.uid()), 'admin'))
  with check ((select auth.uid()) = user_id or public.has_role((select auth.uid()), 'owner') or public.has_role((select auth.uid()), 'admin'));

create or replace function public.feature_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request()
     or public.has_role(auth.uid(), 'owner')
     or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.status <> 'new' or new.admin_note is not null) then
    raise exception 'feature_request_status_is_admin_only' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.status is distinct from old.status
                           or new.admin_note is distinct from old.admin_note) then
    raise exception 'feature_request_status_is_admin_only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger feature_requests_guard
  before insert or update on public.feature_requests
  for each row execute function public.feature_requests_guard();

-- -----------------------------------------------------------------------------
-- Attachments: the row may only point at an object in the user's own folder
-- -----------------------------------------------------------------------------

alter table public.attachments
  add constraint attachments_storage_path_owner
  check (split_part(storage_path, '/', 1) = user_id::text and storage_path not like '%..%');

-- -----------------------------------------------------------------------------
-- Same-owner references: a row may only point at rows of the same user
-- -----------------------------------------------------------------------------

alter table public.tasks add constraint tasks_id_user_id_key unique (id, user_id);
alter table public.contact_table_fields add constraint contact_table_fields_id_user_id_key unique (id, user_id);
alter table public.invoices add constraint invoices_id_user_id_key unique (id, user_id);
alter table public.recurring_payments add constraint recurring_payments_id_user_id_key unique (id, user_id);
alter table public.transactions add constraint transactions_id_user_id_key unique (id, user_id);
alter table public.worker_tasks add constraint worker_tasks_id_owner_id_key unique (id, owner_id);
alter table public.work_sessions add constraint work_sessions_id_owner_id_key unique (id, owner_id);
alter table public.reward_rules add constraint reward_rules_id_owner_id_key unique (id, owner_id);
alter table public.worker_payments add constraint worker_payments_id_owner_id_key unique (id, owner_id);

alter table public.tasks
  drop constraint tasks_parent_task_id_fkey,
  add constraint tasks_parent_task_id_fkey foreign key (parent_task_id, user_id)
    references public.tasks (id, user_id) on delete cascade;

alter table public.contact_table_fields
  drop constraint contact_table_fields_depends_on_field_id_fkey,
  add constraint contact_table_fields_depends_on_field_id_fkey foreign key (depends_on_field_id, user_id)
    references public.contact_table_fields (id, user_id) on delete set null (depends_on_field_id);

alter table public.contact_table_moves
  drop constraint contact_table_moves_contact_id_fkey,
  drop constraint contact_table_moves_from_table_id_fkey,
  drop constraint contact_table_moves_to_table_id_fkey,
  add constraint contact_table_moves_contact_id_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete cascade,
  add constraint contact_table_moves_from_table_id_fkey foreign key (from_table_id, user_id)
    references public.contact_tables (id, user_id) on delete set null (from_table_id),
  add constraint contact_table_moves_to_table_id_fkey foreign key (to_table_id, user_id)
    references public.contact_tables (id, user_id) on delete set null (to_table_id);

alter table public.contact_activities
  drop constraint contact_activities_deal_id_fkey,
  add constraint contact_activities_deal_id_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete set null (deal_id);

alter table public.deals
  drop constraint deals_contact_id_fkey,
  add constraint deals_contact_id_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id);

alter table public.meeting_surveys
  drop constraint meeting_surveys_stage_id_fkey,
  add constraint meeting_surveys_stage_id_fkey foreign key (stage_id, user_id)
    references public.pipeline_stages (id, user_id) on delete set null (stage_id);

alter table public.calendar_events
  drop constraint calendar_events_contact_id_fkey,
  drop constraint calendar_events_deal_id_fkey,
  drop constraint calendar_events_task_id_fkey,
  add constraint calendar_events_contact_id_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id),
  add constraint calendar_events_deal_id_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete set null (deal_id),
  add constraint calendar_events_task_id_fkey foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete set null (task_id);

alter table public.invoices
  drop constraint invoices_contact_id_fkey,
  drop constraint invoices_deal_id_fkey,
  add constraint invoices_contact_id_fkey foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id),
  add constraint invoices_deal_id_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete set null (deal_id);

alter table public.transactions
  drop constraint transactions_deal_id_fkey,
  drop constraint transactions_invoice_id_fkey,
  drop constraint transactions_recurring_payment_id_fkey,
  add constraint transactions_deal_id_fkey foreign key (deal_id, user_id)
    references public.deals (id, user_id) on delete set null (deal_id),
  add constraint transactions_invoice_id_fkey foreign key (invoice_id, user_id)
    references public.invoices (id, user_id) on delete set null (invoice_id),
  add constraint transactions_recurring_payment_id_fkey foreign key (recurring_payment_id, user_id)
    references public.recurring_payments (id, user_id) on delete set null (recurring_payment_id);

alter table public.worker_payments
  drop constraint worker_payments_transaction_id_fkey,
  add constraint worker_payments_transaction_id_fkey foreign key (transaction_id, owner_id)
    references public.transactions (id, user_id) on delete set null (transaction_id);

alter table public.worker_earnings
  drop constraint worker_earnings_reward_rule_id_fkey,
  drop constraint worker_earnings_work_session_id_fkey,
  drop constraint worker_earnings_worker_task_id_fkey,
  drop constraint worker_earnings_payment_id_fkey,
  add constraint worker_earnings_reward_rule_id_fkey foreign key (reward_rule_id, owner_id)
    references public.reward_rules (id, owner_id) on delete set null (reward_rule_id),
  add constraint worker_earnings_work_session_id_fkey foreign key (work_session_id, owner_id)
    references public.work_sessions (id, owner_id) on delete set null (work_session_id),
  add constraint worker_earnings_worker_task_id_fkey foreign key (worker_task_id, owner_id)
    references public.worker_tasks (id, owner_id) on delete set null (worker_task_id),
  add constraint worker_earnings_payment_id_fkey foreign key (payment_id, owner_id)
    references public.worker_payments (id, owner_id) on delete set null (payment_id);

alter table public.ai_usage
  drop constraint ai_usage_conversation_id_fkey,
  add constraint ai_usage_conversation_id_fkey foreign key (conversation_id, user_id)
    references public.jarvis_conversations (id, user_id) on delete set null (conversation_id);

-- The new functions need the same grants as the rest.
revoke execute on function public.is_client_request(), public.contact_tables_guard(),
  public.workers_guard(), public.worker_invites_guard(), public.worker_tasks_guard(),
  public.feature_requests_guard() from public, anon;
