-- =============================================================================
-- Grady's model per job, set in the administration (step 27.3)
--
--   * app_settings key 'grady_models': for each job (chat, milestone_review,
--     briefing, …) the model it runs on (haiku | sonnet | opus | fable | a
--     later one; the chat also 'auto'), 'economy' = economy mode switched on
--     by hand, 'chat_large' = the model the chat's automatic choice may use
--     for big analyses (null = never above Sonnet). The database checks only
--     the shape (valid_grady_models): the catalog of jobs and models lives in
--     the code (src/features/grady/model-settings.ts, src/config/costs.ts),
--     which falls back to a job's default for a model it no longer offers
--     and writes that to the error log. Without a row the defaults apply.
--   * admin_set_app_setting() accepts 'grady_models' too: the owner or a full
--     admin with aal2 and a live admin session, the value checked, the change
--     audited from → to in the same transaction. app_settings stays closed
--     to clients.
--   * ai_usage.routed_from: the model a call would have run on when the
--     chat's automatic choice or economy mode picked it (null = the setting
--     decided). Written by the server like the rest of the row.
--   * jarvis_space_calls() leaves out the chat's routing call (chat_route):
--     the plan's monthly answers count Grady's answers, not the one-word
--     choice before them.
--   * jarvis_budget_alerts: kind 'economy', the one e-mail of the month when
--     Grady switched to economy mode (day = the first day of the UTC month).
--   * admin_ai_model_usage(): calls, tokens and cost by job, model, routed
--     from and long prompt since an instant, for AI and Grady → Models (the
--     estimates "on Haiku / Sonnet / Opus" are priced in the code). Server
--     only.
-- Additive: one new nullable column, a wider check, replaced functions.
-- =============================================================================

create or replace function public.valid_grady_models(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(_value) is distinct from 'object' then false
    when jsonb_typeof(_value -> 'features') is distinct from 'object' then false
    else coalesce(
      -- Exactly the known keys, all of them.
      (select count(*) = 3 and bool_and(k in ('features', 'economy', 'chat_large'))
       from jsonb_object_keys(_value) as k)
      and jsonb_typeof(_value -> 'economy') = 'boolean'
      and (
        jsonb_typeof(_value -> 'chat_large') = 'null'
        or (
          jsonb_typeof(_value -> 'chat_large') = 'string'
          and (_value ->> 'chat_large') ~ '^[a-z][a-z0-9_]{0,39}$'
        )
      )
      -- At most 50 jobs, each a short key with a short model key.
      and (select count(*) <= 50 and coalesce(bool_and(
             t.key ~ '^[a-z][a-z0-9_]{0,39}$'
             and jsonb_typeof(t.value) = 'string'
             and (t.value #>> '{}') ~ '^[a-z][a-z0-9_]{0,39}$'), true)
           from jsonb_each(_value -> 'features') as t),
      false
    )
  end;
$$;

alter table public.app_settings
  add constraint app_settings_grady_models_valid
  check (key <> 'grady_models' or public.valid_grady_models(value));

-- The same function as in 20261104200000_jarvis_rules.sql, with 'grady_models' added.
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
  elsif _key = 'grady_models' then
    if _value is null or not public.valid_grady_models(_value) then
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

-- The model a call would have run on without the automatic choice or economy mode.
alter table public.ai_usage
  add column routed_from text check (routed_from is null or char_length(routed_from) <= 60);
comment on column public.ai_usage.routed_from is
  'The model the call would have run on when the chat''s automatic choice or economy mode picked its model; null = the setting decided (step 27.3).';

-- The same function as in 20261109090000_worker_invites_billing.sql, without the routing call.
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
    and u.purpose <> 'chat_route'
    and u.created_at >= _since;
$$;
revoke all on function public.jarvis_space_calls(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jarvis_space_calls(uuid, uuid, timestamptz) to service_role;

alter table public.jarvis_budget_alerts
  drop constraint jarvis_budget_alerts_kind_check,
  add constraint jarvis_budget_alerts_kind_check
    check (kind in ('near_limit', 'paused', 'economy'));

-- Calls, tokens and cost since an instant by job, model, the model it was
-- routed from and whether the prompt was over 100,000 tokens (Haiku's long
-- prompt price applies per request). Every account, internal ones too, like
-- the budget. Only the server calls it, after the admin gate.
create or replace function public.admin_ai_model_usage(_since timestamptz)
returns table (
  purpose text,
  model text,
  routed_from text,
  long_prompt boolean,
  calls bigint,
  input_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  output_tokens bigint,
  cost_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    u.purpose,
    u.model,
    u.routed_from,
    (u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) > 100000,
    count(*),
    coalesce(sum(u.input_tokens), 0),
    coalesce(sum(u.cache_read_tokens), 0),
    coalesce(sum(u.cache_write_tokens), 0),
    coalesce(sum(u.output_tokens), 0),
    coalesce(sum(u.cost_usd), 0)
  from public.ai_usage u
  where u.created_at >= _since
  group by 1, 2, 3, 4;
$$;
revoke all on function public.admin_ai_model_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_ai_model_usage(timestamptz) to service_role;
