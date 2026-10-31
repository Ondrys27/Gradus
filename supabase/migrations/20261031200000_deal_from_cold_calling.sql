-- =============================================================================
-- Deals from contacts and Cold Calling (17.4)
--   * user_settings.cold_calling_deal_stage_id: the stage a deal made from Cold
--     Calling lands in (null = the first open stage). Only an open stage of a
--     space whose pipeline the user may see.
--   * link_deal_to_booked_meeting(_deal_id): a deal made right after a move
--     into a meeting table takes the meeting that move booked, so the deal's
--     history shows it. SECURITY DEFINER: a caller who may make deals but not
--     edit the calendar still links it.
--   * The contact table "Klient má zájem" (system_key 'interested', between
--     "Odeslán e-mail" and "Domluvená schůzka"; questions: what they are
--     interested in, when to follow up). New spaces get it, existing ones get
--     it only while their tables are still the untouched defaults; everyone
--     else can add it from the table editor (add_interested_contact_table()).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The stage of a deal made from Cold Calling
-- -----------------------------------------------------------------------------

alter table public.user_settings
  add column cold_calling_deal_stage_id uuid
    references public.pipeline_stages (id) on delete set null;

-- A user picks only an open stage of a pipeline they may see (their own, or
-- the space they work in). The server (no user in the request) is not stopped.
create or replace function public.user_settings_deal_stage_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cold_calling_deal_stage_id is null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.cold_calling_deal_stage_id is not distinct from old.cold_calling_deal_stage_id
  then
    return new;
  end if;
  if not exists (
    select 1 from public.pipeline_stages s
    where s.id = new.cold_calling_deal_stage_id
      and not s.is_won
      and not s.is_lost
      and public.has_section_access(s.user_id, 'pipeline', 'view')
  ) then
    raise exception 'deal_stage_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.user_settings_deal_stage_guard() from public, anon, authenticated;

create trigger user_settings_deal_stage_guard
  before insert or update of cold_calling_deal_stage_id on public.user_settings
  for each row execute function public.user_settings_deal_stage_guard();

-- -----------------------------------------------------------------------------
-- A new deal takes the meeting its contact was just booked for
-- -----------------------------------------------------------------------------

-- The meeting is the one move_contact() booked when the contact came into the
-- table it is in now (same transaction, so created at the moment of the move),
-- still without a deal. Anything else (an older meeting, one already on a
-- deal, a contact in a table without meetings) links nothing and returns null.
create or replace function public.link_deal_to_booked_meeting(_deal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _deal public.deals;
  _moved_at timestamptz;
  _event uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into _deal from public.deals where id = _deal_id and user_id = _ws;
  if _deal.id is null then
    raise exception 'deal_not_found' using errcode = 'no_data_found';
  end if;
  if not public.has_section_access(_ws, 'pipeline', 'edit') then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  if _deal.contact_id is null then
    return null;
  end if;

  select e.moved_at into _moved_at from public.contact_table_entries e
  where e.user_id = _ws and e.contact_id = _deal.contact_id;
  if _moved_at is null then
    return null;
  end if;

  update public.calendar_events
  set deal_id = _deal.id
  where id = (
    select c.id from public.calendar_events c
    where c.user_id = _ws
      and c.contact_id = _deal.contact_id
      and c.source = 'contact_move'
      and c.deal_id is null
      and c.created_at >= _moved_at
    order by c.created_at desc
    limit 1
  )
  returning id into _event;
  return _event;
end;
$$;
revoke execute on function public.link_deal_to_booked_meeting(uuid) from public, anon;
grant execute on function public.link_deal_to_booked_meeting(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The table "Klient má zájem"
-- -----------------------------------------------------------------------------

-- Adds the table with its questions to a space (once; a second call returns the
-- one there is). It goes right after the earlier of "Odeslán e-mail" and
-- "Domluvená schůzka" when they sit next to each other (in front of the later
-- one otherwise), or in front of Clients when one of them is gone.
create or replace function public.contact_tables_add_interested(_ws uuid, _cs boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _email integer;
  _meeting integer;
  _position integer;
begin
  -- One at a time per space: the positions below are read and shifted.
  perform 1 from public.contact_tables where user_id = _ws for update;

  select id into _id from public.contact_tables where user_id = _ws and system_key = 'interested';
  if _id is not null then
    return _id;
  end if;

  select position into _email from public.contact_tables
  where user_id = _ws and system_key = 'email_sent';
  select position into _meeting from public.contact_tables
  where user_id = _ws and system_key = 'meeting_scheduled';
  if _email is not null and _meeting is not null then
    _position := greatest(_email, _meeting);
  else
    select position into _position from public.contact_tables
    where user_id = _ws and system_key = 'clients';
    if _position is null then
      select coalesce(max(position) + 1, 0) into _position
      from public.contact_tables where user_id = _ws;
    end if;
  end if;

  update public.contact_tables set position = position + 1
  where user_id = _ws and position >= _position;

  insert into public.contact_tables (user_id, name, color, position, is_system, system_key)
  values (_ws, case when _cs then 'Klient má zájem' else 'Interested' end, 'teal', _position,
          false, 'interested')
  returning id into _id;

  insert into public.contact_table_fields (user_id, table_id, label, type, required, position, system_key) values
    (_ws, _id, case when _cs then 'O co má zájem' else 'What are they interested in?' end,
     'text', false, 0, 'product'),
    (_ws, _id, case when _cs then 'Kdy se ozvat' else 'When to follow up?' end,
     'datetime', false, 1, 'follow_up_at');
  return _id;
end;
$$;
revoke execute on function public.contact_tables_add_interested(uuid, boolean) from public, anon, authenticated;

-- "Upravit tabulky" offers the table to a space that does not have it. Same
-- right as editing the tables (contacts or cold calling, edit); named in the
-- language of the space's owner, like the rest of its tables.
create or replace function public.add_interested_contact_table()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ws uuid := public.current_workspace_id();
  _cs boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not (public.has_section_access(_ws, 'contacts', 'edit')
          or public.has_section_access(_ws, 'cold_calling', 'edit')) then
    raise exception 'section_access_denied' using errcode = 'insufficient_privilege';
  end if;
  select s.locale = 'cs' into _cs from public.user_settings s where s.user_id = _ws;
  return public.contact_tables_add_interested(_ws, coalesce(_cs, false));
end;
$$;
revoke execute on function public.add_interested_contact_table() from public, anon;
grant execute on function public.add_interested_contact_table() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A new space starts with it. The rest of initialize_user() is unchanged.
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

  -- eight contact tables --------------------------------------------------
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

  -- Interested, between "Domluvená schůzka" and "Odeslán e-mail"
  perform public.contact_tables_add_interested(_user_id, _cs);
end;
$$;

revoke execute on function public.initialize_user(uuid, text) from public, anon, authenticated;
grant execute on function public.initialize_user(uuid, text) to service_role, supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Existing spaces: only where the tables are still the defaults
-- -----------------------------------------------------------------------------

-- Untouched = exactly the seven seeded tables, in the seeded order, each still
-- under its seeded Czech or English name. A space that renamed, reordered,
-- added or removed a table keeps its tables as they are and finds the new
-- one offered in the table editor.
create or replace function public.contact_tables_untouched(_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with defaults (system_key, rank, cs, en) as (
    values
      ('unreached', 1, 'Neoslovení klienti', 'Unreached'),
      ('no_answer', 2, 'Nezvedají telefon', 'No answer'),
      ('failed', 3, 'Neúspěch', 'Unsuccessful'),
      ('meeting_scheduled', 4, 'Domluvená schůzka', 'Meeting scheduled'),
      ('email_sent', 5, 'Odeslán e-mail', 'Email sent'),
      ('follow_up', 6, 'Ozvat se', 'Follow up'),
      ('clients', 7, 'Klienti', 'Clients')
  ),
  current_tables as (
    select t.system_key, t.name,
           row_number() over (order by t.position, t.created_at, t.id) as rank
    from public.contact_tables t
    where t.user_id = _ws
  )
  select (select count(*) from current_tables) = 7
     and not exists (
       select 1 from current_tables c
       left join defaults d on d.system_key = c.system_key and d.rank = c.rank
       where d.system_key is null or c.name not in (d.cs, d.en)
     );
$$;
revoke execute on function public.contact_tables_untouched(uuid) from public, anon, authenticated;

do $$
declare
  _space record;
begin
  for _space in
    select t.user_id, bool_or(t.system_key = 'unreached' and t.name = 'Neoslovení klienti') as cs
    from public.contact_tables t
    group by t.user_id
  loop
    if public.contact_tables_untouched(_space.user_id) then
      perform public.contact_tables_add_interested(_space.user_id, _space.cs);
    end if;
  end loop;
end;
$$;
