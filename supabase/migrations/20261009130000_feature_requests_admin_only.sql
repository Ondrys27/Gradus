-- =============================================================================
-- Feature requests: other people's ideas only through the administration
--
-- The owner and admin roles used to read and update every feature request
-- straight from the app client, without the second factor. Since step 11.3
-- the administration (owner + aal2 + admin session, server side through the
-- admin client) is the only place for them. From the client, everyone sees
-- and edits only their own requests, and nobody sets status or note.
-- =============================================================================

drop policy "feature_requests_select" on public.feature_requests;
create policy "feature_requests_select_own" on public.feature_requests for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy "feature_requests_update" on public.feature_requests;
create policy "feature_requests_update_own" on public.feature_requests for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Status and the admin note: only the server (the administration's admin client).
create or replace function public.feature_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_client_request() then
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
