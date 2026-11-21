-- =============================================================================
-- The showcase mode (step 27.4): the app plays itself for a marketing video
--
--   * app_settings key 'showcase_mode' = { "enabled": true | false }, off
--     without a row. Only the owner or a full admin switches it (aal2, live
--     admin session) through admin_set_app_setting(), which checks the shape
--     (valid_showcase_mode) and audits the change in the same transaction.
--     app_settings stays closed to clients; the server reads it.
--   * The showcase runs in a throw-away internal account the server makes
--     and deletes (showcase-…@gradus.local, marked in auth app_metadata,
--     which only the secret key sets): no table of its own.
--   * The analytics catalog gets showcase_started / showcase_finished.
-- Additive: a new function, a wider check, a replaced function, new rows.
-- =============================================================================

create or replace function public.valid_showcase_mode(_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_value) = 'object'
    and jsonb_typeof(_value -> 'enabled') = 'boolean'
    and coalesce(
      (select bool_and(k = 'enabled') from jsonb_object_keys(_value) as k),
      false
    );
$$;

alter table public.app_settings
  add constraint app_settings_showcase_mode_valid
  check (key <> 'showcase_mode' or public.valid_showcase_mode(value));

-- The same function as in 20261123090000_grady_models.sql, with 'showcase_mode' added.
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
  elsif _key = 'showcase_mode' then
    if _value is null or not public.valid_showcase_mode(_value) then
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

-- -----------------------------------------------------------------------------
-- Analytics catalog (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('showcase_started', 'onboarding', false),
  ('showcase_finished', 'onboarding', false)
on conflict (event) do nothing;
