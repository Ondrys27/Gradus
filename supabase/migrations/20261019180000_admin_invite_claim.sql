-- =============================================================================
-- One new account per administrator invitation (review K14)
--
--   * admin_invites gains claimed_by / claimed_at: the account created on the
--     invitation page holds the link from that moment on. Until the invitation
--     is accepted, revoked or expires, no second account can be created with it.
--   * admin_invite_claim(): the account just created, signed in with its fresh
--     session (aal1 is enough, the second factor comes later). One conditional
--     UPDATE: two parallel sign-ups cannot both win. Calling it again from the
--     same account is a no-op, so a retry after a network error works.
--   * The invitation is still not bound to an e-mail, and signing in to an
--     existing account on the link (to finish an interrupted TOTP set-up) does
--     not claim anything. admin_invite_accept is unchanged.
--   * admin_invites stays written only through SECURITY DEFINER functions:
--     admin_invite_create / admin_invite_revoke / admin_invite_claim /
--     admin_invite_accept.
-- =============================================================================

alter table public.admin_invites
  add column claimed_by uuid references auth.users (id) on delete set null,
  add column claimed_at timestamptz;

comment on table public.admin_invites is
  'Invitations to the administration. Read by the server (admin client); written only through admin_invite_create / admin_invite_revoke / admin_invite_claim / admin_invite_accept.';

create or replace function public.admin_invite_claim(_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _id uuid;
  _first boolean;
begin
  if _uid is null or public.has_role(_uid, 'owner') then
    raise exception 'invalid_invite' using errcode = '42501';
  end if;
  update public.admin_invites
  set claimed_by = _uid, claimed_at = coalesce(claimed_at, now())
  where token_hash = _token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and (claimed_by is null or claimed_by = _uid)
  returning id, claimed_at = now() into _id, _first;
  if _id is null then
    raise exception 'invalid_invite' using errcode = '42501';
  end if;

  if _first then
    insert into public.admin_audit (user_id, kind, target, detail)
    values (
      _uid, 'update', 'admins.claim',
      jsonb_build_object('user', _uid, 'invite', _id,
                         'from', jsonb_build_object('state', 'open'),
                         'to', jsonb_build_object('state', 'claimed'))
    );
  end if;
end;
$$;
revoke all on function public.admin_invite_claim(text) from public, anon;
grant execute on function public.admin_invite_claim(text) to authenticated;
