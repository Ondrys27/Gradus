-- =============================================================================
-- Moving a contact
--   * answers are checked against the questions of the target table: only
--     questions shown (their dependency met) are kept, required ones must be
--     answered, every answer must fit its type
--   * every move is an activity, so it counts as the last contact
--   * a date-and-time answer to a meeting question books a calendar event
-- =============================================================================

create or replace function public.move_contact(
  _contact_id uuid,
  _to_table_id uuid,
  _answers jsonb default '{}'::jsonb
)
returns public.contact_table_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _target public.contact_tables;
  _contact public.contacts;
  _from uuid;
  _entry public.contact_table_entries;
  _given jsonb := coalesce(_answers, '{}'::jsonb);
  _clean jsonb := '{}'::jsonb;
  _field public.contact_table_fields;
  _value jsonb;
  _text text;
  _starts timestamptz;
begin
  select * into _target from public.contact_tables
  where id = _to_table_id and user_id = _uid;
  if _target.id is null then
    raise exception 'contact_table_not_found' using errcode = 'no_data_found';
  end if;
  if _target.system_key = 'clients' then
    raise exception 'cannot_move_into_system_table' using errcode = 'check_violation';
  end if;
  select * into _contact from public.contacts where id = _contact_id and user_id = _uid;
  if _contact.id is null then
    raise exception 'contact_not_found' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(_given) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'check_violation';
  end if;

  -- Questions shown for these answers: no dependency, or the answer they hang on was given
  -- to a question that is itself shown.
  for _field in
    with recursive shown as (
      select f.id from public.contact_table_fields f
      where f.table_id = _target.id and f.depends_on_field_id is null
      union
      select f.id from public.contact_table_fields f
      join shown s on s.id = f.depends_on_field_id
      where f.table_id = _target.id
        and _given ->> f.depends_on_field_id::text = f.depends_on_value
    )
    select f.* from public.contact_table_fields f
    join shown s on s.id = f.id
    order by f.position
  loop
    _value := _given -> _field.id::text;
    if _value is null or jsonb_typeof(_value) = 'null'
       or (jsonb_typeof(_value) = 'string' and btrim(_value #>> '{}') = '') then
      if _field.required then
        raise exception 'answer_required' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      continue;
    end if;

    if _field.type = 'boolean' then
      if jsonb_typeof(_value) <> 'boolean' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
    else
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      _text := _value #>> '{}';
      if char_length(_text) > 5000
         or (_field.type = 'date' and _text !~ '^\d{4}-\d{2}-\d{2}$')
         or (_field.type = 'datetime' and _text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
         or (_field.type = 'select' and not exists (
               select 1 from jsonb_array_elements(_field.options) o where o ->> 'key' = _text
             )) then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end if;
      begin
        if _field.type = 'date' then
          perform _text::date;
        elsif _field.type = 'datetime' then
          perform _text::timestamptz;
        end if;
      exception when others then
        raise exception 'invalid_answer' using errcode = 'check_violation', detail = _field.id::text;
      end;
    end if;
    _clean := _clean || jsonb_build_object(_field.id::text, _value);
  end loop;

  select table_id into _from from public.contact_table_entries
  where user_id = _uid and contact_id = _contact_id;

  insert into public.contact_table_entries (user_id, contact_id, table_id, answers, moved_at)
  values (_uid, _contact_id, _to_table_id, _clean, now())
  on conflict (user_id, contact_id) do update
    set table_id = excluded.table_id,
        answers = excluded.answers,
        moved_at = excluded.moved_at
  returning * into _entry;

  insert into public.contact_table_moves (user_id, contact_id, from_table_id, to_table_id, answers)
  values (_uid, _contact_id, _from, _to_table_id, _clean);

  -- The table's name at the time of the move; the history keeps it after a rename.
  insert into public.contact_activities (user_id, contact_id, type, content)
  values (_uid, _contact_id, 'move', _target.name);

  for _field in
    select * from public.contact_table_fields
    where table_id = _target.id and type = 'datetime' and system_key = 'meeting_at'
  loop
    if _clean ? _field.id::text then
      _starts := (_clean ->> _field.id::text)::timestamptz;
      insert into public.calendar_events (user_id, title, kind, starts_at, contact_id)
      values (
        _uid,
        coalesce(
          nullif(btrim(_contact.company_name), ''),
          nullif(btrim(concat_ws(' ', _contact.first_name, _contact.last_name)), '')
        ),
        'meeting',
        _starts,
        _contact_id
      );
    end if;
  end loop;

  return _entry;
end;
$$;

revoke execute on function public.move_contact(uuid, uuid, jsonb) from public, anon;
grant execute on function public.move_contact(uuid, uuid, jsonb) to authenticated;
