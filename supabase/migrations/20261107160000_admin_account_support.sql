-- =============================================================================
-- Administration: helping one account from its detail (step 22.1)
--   * admin_user_sign_out(_user_id): ends every sign-in of the account (a
--     stolen account): its Auth sessions and their refresh tokens go, so no
--     device can renew its token; an access token already issued lapses on its
--     own within the hour. A live admin session of the account ends too.
--     Returns how many sessions there were.
--   * admin_email_taken(_email): whether another account signs in with that
--     address already, so a change of e-mail is refused before anything is
--     sent to the new address.
-- Service role only: the server calls it after the administration's guard,
-- with the reason already in admin_audit. Nothing else changes; the other
-- support actions (password reset, a new confirmation link, a changed
-- e-mail) go through the Auth admin API.
-- =============================================================================

create or replace function public.admin_user_sign_out(_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _count integer;
begin
  if _user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;
  delete from auth.sessions s where s.user_id = _user_id;
  get diagnostics _count = row_count;
  -- Refresh tokens without a session (older clients) name only the user.
  delete from auth.refresh_tokens r where r.user_id = _user_id::text;
  update public.admin_sessions set ended_at = now()
  where user_id = _user_id and ended_at is null;
  return _count;
end;
$$;

comment on function public.admin_user_sign_out(uuid) is
  'Signs an account out everywhere (Auth sessions, refresh tokens, live admin session). Service role only, after the administration guard and its audit row.';

revoke all on function public.admin_user_sign_out(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_sign_out(uuid) to service_role;

create or replace function public.admin_email_taken(_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(btrim(u.email)) = lower(btrim(coalesce(_email, '')))
  );
$$;

revoke all on function public.admin_email_taken(text) from public, anon, authenticated;
grant execute on function public.admin_email_taken(text) to service_role;
