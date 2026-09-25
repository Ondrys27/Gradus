-- =============================================================================
-- Contact table editor
--   * removing a table moves its contacts in one transaction, as moves
--   * Clients has no questions
--   * a dependent question hangs on a select question of the same table, on one
--     of its options, and never on itself
-- =============================================================================

create or replace function public.remove_contact_table(_table_id uuid, _move_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _table public.contact_tables;
  _target public.contact_tables;
begin
  select * into _table from public.contact_tables where id = _table_id and user_id = _uid;
  if _table.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _table.is_system then
    raise exception 'system_table_readonly' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.contact_table_entries where table_id = _table_id and user_id = _uid) then
    select * into _target from public.contact_tables
    where id = _move_to and user_id = _uid and id <> _table_id;
    if _target.id is null then
      raise exception 'target_table_required' using errcode = 'check_violation';
    end if;
    if _target.system_key = 'clients' then
      raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
    end if;

    insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
    select _uid, contact_id, _table_id, _target.id, '{}'::jsonb
    from public.contact_table_entries
    where table_id = _table_id and user_id = _uid;

    update public.contact_table_entries
      set table_id = _target.id, answers = '{}'::jsonb, moved_at = now()
      where table_id = _table_id and user_id = _uid;
  end if;

  delete from public.contact_tables where id = _table_id and user_id = _uid;
end;
$$;

create or replace function public.contact_table_fields_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _parent public.contact_table_fields;
begin
  if exists (
    select 1 from public.contact_tables where id = new.table_id and system_key = 'clients'
  ) then
    raise exception 'clients_table_has_no_questions' using errcode = 'check_violation';
  end if;

  if new.type = 'select' and (
       jsonb_typeof(new.options) <> 'array'
       or jsonb_array_length(new.options) = 0
       or exists (
         select 1 from jsonb_array_elements(new.options) o
         where coalesce(o ->> 'key', '') = '' or coalesce(o ->> 'label', '') = ''
       )
     ) then
    raise exception 'select_needs_options' using errcode = 'check_violation';
  end if;

  if new.depends_on_field_id is not null then
    select * into _parent from public.contact_table_fields where id = new.depends_on_field_id;
    if _parent.id is null
       or _parent.id = new.id
       or _parent.table_id <> new.table_id
       or _parent.type <> 'select'
       or not exists (
         select 1 from jsonb_array_elements(_parent.options) o
         where o ->> 'key' = new.depends_on_value
       ) then
      raise exception 'invalid_dependency' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger contact_table_fields_guard
  before insert or update on public.contact_table_fields
  for each row execute function public.contact_table_fields_guard();

-- Questions that hang on an option the select no longer has (or on a question
-- that is no longer a select) go with it.
create or replace function public.contact_table_fields_prune_dependents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.contact_table_fields d
  where d.depends_on_field_id = new.id
    and (
      new.type <> 'select'
      or not exists (
        select 1 from jsonb_array_elements(new.options) o
        where o ->> 'key' = d.depends_on_value
      )
    );
  return null;
end;
$$;
create trigger contact_table_fields_prune_dependents
  after update of type, options on public.contact_table_fields
  for each row execute function public.contact_table_fields_prune_dependents();

alter table public.contact_tables
  add constraint contact_tables_name_length check (char_length(btrim(name)) between 1 and 40);
alter table public.contact_table_fields
  add constraint contact_table_fields_label_length check (char_length(btrim(label)) between 1 and 120);

revoke execute on function public.remove_contact_table(uuid, uuid),
  public.contact_table_fields_guard(), public.contact_table_fields_prune_dependents()
  from public, anon;
