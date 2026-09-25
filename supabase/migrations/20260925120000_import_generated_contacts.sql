-- =============================================================================
-- Generated contacts (Google Places): saved as the signed-in user, duplicates
-- skipped by place id, phone without formatting (country prefix ignored) and
-- name with address. New contacts land in Unreached through the insert trigger.
-- =============================================================================

create or replace function public.import_generated_contacts(
  _places jsonb,
  _limit integer,
  _country text default null
)
returns table (created integer, duplicates integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _place jsonb;
  _name text;
  _address text;
  _phone text;
  _inserted integer;
  _created integer := 0;
  _duplicates integer := 0;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(_places) <> 'array' then
    raise exception 'invalid_places' using errcode = 'check_violation';
  end if;

  for _place in select value from jsonb_array_elements(_places) loop
    exit when _created >= _limit;
    _name := nullif(btrim(_place ->> 'name'), '');
    if _name is null or nullif(btrim(_place ->> 'id'), '') is null then
      continue;
    end if;
    _address := nullif(btrim(_place ->> 'address'), '');
    _phone := public.normalize_phone(_place ->> 'phone');

    if exists (
      select 1 from public.contacts c
      where c.user_id = _uid
        and (
          c.external_place_id = _place ->> 'id'
          or (_phone is not null and char_length(_phone) >= 6
              and right(c.phone_normalized, 9) = right(_phone, 9))
          or (_address is not null
              and lower(c.company_name) = lower(_name)
              and lower(c.address) = lower(_address))
        )
    ) then
      _duplicates := _duplicates + 1;
      continue;
    end if;

    insert into public.contacts
      (user_id, company_name, phone, website, address, country_code, external_place_id, source)
    values (
      _uid,
      left(_name, 120),
      left(nullif(btrim(_place ->> 'phone'), ''), 40),
      left(nullif(btrim(_place ->> 'website'), ''), 300),
      left(_address, 300),
      _country,
      _place ->> 'id',
      'generated'
    )
    on conflict (user_id, external_place_id) where external_place_id is not null do nothing;
    get diagnostics _inserted = row_count;
    if _inserted = 0 then
      _duplicates := _duplicates + 1;
    else
      _created := _created + 1;
    end if;
  end loop;

  return query select _created, _duplicates;
end;
$$;

revoke execute on function public.import_generated_contacts(jsonb, integer, text) from public, anon;
grant execute on function public.import_generated_contacts(jsonb, integer, text) to authenticated;
