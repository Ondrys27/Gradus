-- =============================================================================
-- The user's cancel reason next to Stripe (review of phase 23)
--   * Cancelling a subscription that runs in Stripe sets cancel_at_period_end
--     in Stripe first and records the reason in Gradus right after. When the
--     webhook of that change wins the race, the row already says
--     cancel_at_period_end = true without a reason, and subscription_cancel()
--     used to take it as "already cancelled": the reason and the note were
--     lost. Now a cancellation without a reason takes the user's.
--   * The signature stays; nothing else changes.
-- =============================================================================

-- Cancels at the end of the period (the trial's end while trialing). Twice is
-- once; a cancellation that has no reason yet (Stripe's webhook was first)
-- takes this one.
create or replace function public.subscription_cancel(
  _user_id uuid,
  _reason text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _sub public.subscriptions%rowtype;
  _period_end timestamptz;
  _clean_note text := nullif(btrim(coalesce(_note, '')), '');
  _already boolean;
begin
  if _user_id is null or _reason is null or _reason not in
     ('too_expensive', 'missing_features', 'not_using', 'switching', 'temporary', 'other')
     or char_length(coalesce(_clean_note, '')) > 1000 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  select * into _sub from public.subscriptions s where s.user_id = _user_id for update;
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  if array_position(array['solo', 'pro', 'team'], _sub.plan_key) is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if public.subscription_expired(
       _sub.status, _sub.trial_ends_at, _sub.current_period_end, _sub.cancel_at_period_end) then
    raise exception 'expired' using errcode = '55000';
  end if;
  _period_end := case when _sub.status = 'trialing' then _sub.trial_ends_at else _sub.current_period_end end;
  if _period_end is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  _already := _sub.cancel_at_period_end and _sub.cancel_reason is not null;
  if not _already then
    update public.subscriptions
    set cancel_at_period_end = true, cancel_reason = _reason, cancel_note = _clean_note,
        cancel_requested_at = coalesce(case when _sub.cancel_at_period_end then cancel_requested_at end, now()),
        updated_at = now()
    where user_id = _user_id;
  end if;

  return jsonb_build_object(
    'already', _already,
    'ends_at', _period_end,
    'plan', _sub.plan_key,
    'billing', _sub.billing,
    'trialing', _sub.status = 'trialing'
  );
end;
$$;
revoke execute on function public.subscription_cancel(uuid, text, text) from public, anon, authenticated;
grant execute on function public.subscription_cancel(uuid, text, text) to service_role;

