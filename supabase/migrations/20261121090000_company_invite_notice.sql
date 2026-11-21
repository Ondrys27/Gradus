-- =============================================================================
-- The owner hears about a registration from an invite link, too
--
-- Accepting an invite in the app (worker_invite_respond) has always told the
-- owner (account_notifications 'invite_accepted'); a new person registering
-- from the owner's link, the most common way in, did not, so the owner's bell
-- stayed silent. accept_worker_invite is the same as in 20261119090000 plus
-- that one insert.
-- =============================================================================

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

  insert into public.account_notifications (user_id, kind, worker_id)
  values (_invite.owner_id, 'invite_accepted', _invite.worker_id);
  return _invite.worker_id;
end;
$$;
revoke execute on function public.accept_worker_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_worker_invite(text, uuid) to service_role;
