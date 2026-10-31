-- =============================================================================
-- Pipeline health and filters (17.3)
--   * deal_tasks_last_done(_workspace): when the last task of each open deal
--     was finished, for "bez úkolu 9 dní" on the dashboard above the pipeline.
--     Runs as the caller, so RLS of deals and crm_tasks decides what counts.
--   * initialize_user(): a new space starts with the stages Nový lead · Schůzka ·
--     Koncept nabídky · Nabídka odeslána · Vyhráno · Ztraceno. Existing spaces
--     keep theirs; the deposit stage can still be marked on any stage.
--   * analytics_event_catalog: the new events of the pipeline filters and tiles.
-- =============================================================================

create or replace function public.deal_tasks_last_done(_workspace uuid)
returns table (deal_id uuid, last_done_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.deal_id, max(t.completed_at)
  from public.crm_tasks t
  join public.deals d on d.id = t.deal_id and d.user_id = t.user_id
  where t.user_id = _workspace
    and t.status = 'done'
    and t.completed_at is not null
    and d.won_at is null
    and d.lost_at is null
  group by t.deal_id
  limit 5000;
$$;
revoke execute on function public.deal_tasks_last_done(uuid) from public, anon;
grant execute on function public.deal_tasks_last_done(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Stages of a new space. The rest of initialize_user() is unchanged.
-- -----------------------------------------------------------------------------

create or replace function public.initialize_user(_user_id uuid, _locale text default 'en')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _cs boolean := coalesce(_locale, 'en') = 'cs';
  _plan text;
  _t_failed uuid;
  _t_meeting uuid;
  _t_email uuid;
  _t_follow uuid;
  _f_reason uuid;
begin
  -- profile, settings, role, subscription --------------------------------
  insert into public.profiles (id) values (_user_id)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, locale)
  values (_user_id, case when _cs then 'cs' else 'en' end)
  on conflict (user_id) do nothing;

  -- the very first account becomes the owner
  if not exists (select 1 from public.user_roles where user_id = _user_id) then
    insert into public.user_roles (user_id, role)
    values (_user_id, case when exists (select 1 from public.user_roles) then 'user' else 'owner' end::public.app_role);
  end if;

  select key into _plan from public.plans where is_default limit 1;
  if _plan is not null then
    insert into public.subscriptions (user_id, plan_key) values (_user_id, _plan)
    on conflict (user_id) do nothing;
  end if;

  -- six pipeline stages ---------------------------------------------------
  if not exists (select 1 from public.pipeline_stages where user_id = _user_id) then
    insert into public.pipeline_stages (user_id, name, color, position, is_won, is_lost, system_key) values
      (_user_id, case when _cs then 'Nový lead' else 'New lead' end, 'violet', 0, false, false, 'lead'),
      (_user_id, case when _cs then 'Schůzka' else 'Meeting' end, 'teal', 1, false, false, 'meeting'),
      (_user_id, case when _cs then 'Koncept nabídky' else 'Offer draft' end, 'neutral', 2, false, false, 'offer_draft'),
      (_user_id, case when _cs then 'Nabídka odeslána' else 'Offer sent' end, 'gold', 3, false, false, 'offer'),
      (_user_id, case when _cs then 'Vyhráno' else 'Won' end, 'green', 4, true, false, 'won'),
      (_user_id, case when _cs then 'Ztraceno' else 'Lost' end, 'pink', 5, false, true, 'lost');
  end if;

  -- seven contact tables --------------------------------------------------
  if exists (select 1 from public.contact_tables where user_id = _user_id) then
    return;
  end if;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key) values
    (_user_id, case when _cs then 'Neoslovení klienti' else 'Unreached' end, 'slate', 0, true, 'unreached'),
    (_user_id, case when _cs then 'Nezvedají telefon' else 'No answer' end, 'blue', 1, false, 'no_answer');

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Neúspěch' else 'Unsuccessful' end, 'pink', 2, false, 'failed')
  returning id into _t_failed;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Domluvená schůzka' else 'Meeting scheduled' end, 'green', 3, false, 'meeting_scheduled')
  returning id into _t_meeting;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Odeslán e-mail' else 'Email sent' end, 'violet', 4, false, 'email_sent')
  returning id into _t_email;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Ozvat se' else 'Follow up' end, 'gold', 5, false, 'follow_up')
  returning id into _t_follow;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_user_id, case when _cs then 'Klienti' else 'Clients' end, 'teal', 6, true, 'clients');

  -- Unsuccessful: reason + dependent "why" fields
  insert into public.contact_table_fields (user_id, table_id, label, type, required, options, position, system_key)
  values (
    _user_id, _t_failed,
    case when _cs then 'Důvod' else 'Reason' end,
    'select', true,
    case when _cs then
      '[{"key":"has_solution","label":"Už mají řešení"},{"key":"not_interested","label":"Nemají zájem"},{"key":"no_budget","label":"Nemá finance"},{"key":"not_target_group","label":"Není cílová skupina"},{"key":"other","label":"Jiné"}]'::jsonb
    else
      '[{"key":"has_solution","label":"Already have a solution"},{"key":"not_interested","label":"Not interested"},{"key":"no_budget","label":"No budget"},{"key":"not_target_group","label":"Not the target group"},{"key":"other","label":"Other"}]'::jsonb
    end,
    0, 'reason'
  )
  returning id into _f_reason;

  insert into public.contact_table_fields (user_id, table_id, label, type, required, depends_on_field_id, depends_on_value, position) values
    (_user_id, _t_failed, case when _cs then 'Proč?' else 'Why?' end, 'long_text', false, _f_reason, 'not_interested', 1),
    (_user_id, _t_failed, case when _cs then 'Proč?' else 'Why?' end, 'long_text', false, _f_reason, 'not_target_group', 2),
    (_user_id, _t_failed, case when _cs then 'Popis' else 'Description' end, 'long_text', false, _f_reason, 'other', 3);

  -- Meeting scheduled
  insert into public.contact_table_fields (user_id, table_id, label, type, required, position, system_key) values
    (_user_id, _t_meeting, case when _cs then 'Kdy?' else 'When?' end, 'datetime', true, 0, 'meeting_at'),
    (_user_id, _t_meeting, case when _cs then 'Podrobnosti' else 'Details' end, 'long_text', false, 1, null),
    (_user_id, _t_meeting, case when _cs then 'O jaký produkt má zájem' else 'Which product are they interested in?' end, 'text', false, 2, 'product');

  -- Email sent
  insert into public.contact_table_fields (user_id, table_id, label, type, required, default_value, position, system_key) values
    (_user_id, _t_email, case when _cs then 'Vložit odeslaný e-mail' else 'Paste the sent email' end, 'long_text', false, null, 0, 'email_body'),
    (_user_id, _t_email, case when _cs then 'Kdy byl poslán' else 'When was it sent?' end, 'date', true, 'today', 1, 'sent_on');

  -- Follow up
  insert into public.contact_table_fields (user_id, table_id, label, type, required, position, system_key) values
    (_user_id, _t_follow, case when _cs then 'Kdy?' else 'When?' end, 'datetime', true, 0, 'follow_up_at'),
    (_user_id, _t_follow, case when _cs then 'Podrobnosti' else 'Details' end, 'long_text', false, 1, null),
    (_user_id, _t_follow, case when _cs then 'O jaký produkt měl zájem' else 'Which product were they interested in?' end, 'text', false, 2, 'product');
end;
$$;

revoke execute on function public.initialize_user(uuid, text) from public, anon, authenticated;
grant execute on function public.initialize_user(uuid, text) to service_role, supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Analytics: filters and tiles of the pipeline (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('pipeline_filtered', 'pipeline', false),
  ('pipeline_health_opened', 'pipeline', false)
on conflict (event) do nothing;
