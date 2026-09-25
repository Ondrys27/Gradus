-- =============================================================================
-- Contacts
--   * phone_normalized is derived from phone by the database, never by the client
--   * every contact sits in exactly one table from the moment it exists
--   * the list reads last contact from the activities; nothing stores it
-- =============================================================================

-- Digits only, the "00" international prefix dropped: "+420 777-123 456" → "420777123456".
create or replace function public.normalize_phone(_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(regexp_replace(coalesce(_phone, ''), '\D', '', 'g'), '^00', ''), '');
$$;

create or replace function public.contacts_normalize_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone_normalized := public.normalize_phone(new.phone);
  return new;
end;
$$;
create trigger contacts_normalize_phone
  before insert or update on public.contacts
  for each row execute function public.contacts_normalize_phone();

update public.contacts set phone_normalized = public.normalize_phone(phone);

-- A new contact starts in the "unreached" table. Membership changes later only
-- through move_contact() and the won-deal trigger.
create or replace function public.contacts_place_in_unreached()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _unreached uuid;
begin
  select id into _unreached from public.contact_tables
  where user_id = new.user_id and system_key = 'unreached';
  if _unreached is not null then
    insert into public.contact_table_entries (user_id, contact_id, table_id)
    values (new.user_id, new.id, _unreached)
    on conflict (user_id, contact_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger contacts_place_in_unreached
  after insert on public.contacts
  for each row execute function public.contacts_place_in_unreached();

-- Contacts created before this migration (e.g. from the deal form) get their table now.
insert into public.contact_table_entries (user_id, contact_id, table_id)
select c.user_id, c.id, t.id
from public.contacts c
join public.contact_tables t on t.user_id = c.user_id and t.system_key = 'unreached'
where not exists (
  select 1 from public.contact_table_entries e
  where e.user_id = c.user_id and e.contact_id = c.id
);

alter table public.contacts
  add constraint contacts_notes_length check (char_length(notes) <= 5000);
alter table public.contact_activities
  add constraint contact_activities_content_length check (char_length(content) <= 5000);

-- The contact list: one row per contact with its table and the time of the
-- latest activity. security_invoker keeps the RLS of the underlying tables.
create view public.contact_list
with (security_invoker = true)
as
select
  c.id,
  c.company_name,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.phone_normalized,
  c.city,
  c.source,
  c.created_at,
  concat_ws(' ', c.company_name, c.first_name, c.last_name) as search_name,
  e.table_id,
  (
    select max(a.occurred_at)
    from public.contact_activities a
    where a.contact_id = c.id and a.occurred_at <= now()
  ) as last_contact_at
from public.contacts c
left join public.contact_table_entries e
  on e.contact_id = c.id and e.user_id = c.user_id;

revoke all on public.contact_list from anon;
grant select on public.contact_list to authenticated;

revoke execute on function public.normalize_phone(text), public.contacts_normalize_phone(),
  public.contacts_place_in_unreached() from public, anon;
