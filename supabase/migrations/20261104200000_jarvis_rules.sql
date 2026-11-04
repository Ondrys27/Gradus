-- =============================================================================
-- Jarvis's rules in the administration (step 20.1)
--
--   * app_settings key 'jarvis_rules': which suggestion types may come up on
--     their own, whether Jarvis asks his questions, the numbers of the timing
--     (the floor of the gap in hours, questions a week, how many days a
--     suggestion stays fresh, the page's settling in seconds) and the owner's
--     instructions for the system prompt (at most 2,000 characters). Without
--     a row today's constants apply (src/features/jarvis/rules.ts).
--   * valid_jarvis_rules() checks the value like storedJarvisRulesSchema;
--     the table keeps a check constraint with it, as for the other keys.
--   * admin_set_app_setting() accepts 'jarvis_rules' too: the owner with aal2
--     and a live admin session (admin_require_owner), the value checked, the
--     change audited from → to in the same transaction. Nothing else changes:
--     app_settings stays closed to clients, the server reads it.
-- =============================================================================

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
      -- Exactly the known keys, all of them.
      (select count(*) = 7 and bool_and(k in (
         'suggestion_types', 'questions', 'min_gap_hours', 'questions_per_week',
         'suggestion_fresh_days', 'page_settle_seconds', 'instructions'))
       from jsonb_object_keys(_value) as k)
      -- PROACTIVE_SUGGESTION_TYPES in src/features/jarvis/proactive.ts, each on or off.
      and (select coalesce(bool_and(
             t.key in ('insight', 'stalledDeal', 'overdueTask', 'overdueInvoice',
                       'overdueCrmTask', 'milestoneReady', 'followUps', 'pathReady')
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

alter table public.app_settings
  add constraint app_settings_jarvis_rules_valid
  check (key <> 'jarvis_rules' or public.valid_jarvis_rules(value));

-- The same function as in 20261027090000_error_alerts.sql, with 'jarvis_rules' added.
create or replace function public.admin_set_app_setting(
  _key text,
  _value jsonb,
  _ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _old jsonb;
begin
  perform public.admin_require_owner();
  if _key = 'ai_caps' then
    if _value is null or not public.valid_ai_caps(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'error_alerts' then
    if _value is null or not public.valid_error_alerts(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  elsif _key = 'jarvis_rules' then
    if _value is null or not public.valid_jarvis_rules(_value) then
      raise exception 'invalid_value' using errcode = '22023';
    end if;
  else
    raise exception 'unknown_setting' using errcode = '22023';
  end if;

  select s.value into _old from public.app_settings s where s.key = _key for update;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values (_key, _value, now(), _uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.admin_audit (user_id, kind, target, ip_hash, detail)
  values (
    _uid, 'update', 'settings.' || _key, _ip_hash,
    case when _key = 'error_alerts'
      then jsonb_build_object(
        'key', _key,
        'from', public.error_alerts_audit(_old),
        'to', public.error_alerts_audit(_value))
      else jsonb_build_object('key', _key, 'from', _old, 'to', _value)
    end
  );
  return _old;
end;
$$;
revoke all on function public.admin_set_app_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb, text) to authenticated;
