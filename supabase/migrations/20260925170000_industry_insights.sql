-- =============================================================================
-- Best industries
--   * generated contacts remember the industry they were searched for
--   * industry_insights() unlocks the card itself once the user has booked 10
--     meetings (the unlock is written here, never by the client) and, once
--     unlocked, returns the meeting share per industry from the user's own data
-- =============================================================================

alter table public.contacts
  add column generated_industry text check (char_length(generated_industry) <= 80);

drop function public.import_generated_contacts(jsonb, integer, text);

create or replace function public.import_generated_contacts(
  _places jsonb,
  _limit integer,
  _country text default null,
  _industry text default null
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
      (user_id, company_name, phone, website, address, country_code, external_place_id, source,
       generated_industry)
    values (
      _uid,
      left(_name, 120),
      left(nullif(btrim(_place ->> 'phone'), ''), 40),
      left(nullif(btrim(_place ->> 'website'), ''), 300),
      left(_address, 300),
      _country,
      _place ->> 'id',
      'generated',
      left(nullif(btrim(_industry), ''), 80)
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

revoke execute on function public.import_generated_contacts(jsonb, integer, text, text) from public, anon;
grant execute on function public.import_generated_contacts(jsonb, integer, text, text) to authenticated;

create or replace function public.industry_insights()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _needed constant integer := 10;
  _meetings integer;
  _unlock public.unlocks;
  _industries jsonb := '[]'::jsonb;
begin
  if _uid is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into _meetings
  from public.contact_table_moves m
  join public.contact_tables t on t.id = m.to_table_id
  where m.user_id = _uid and t.system_key = 'meeting_scheduled';

  if _meetings >= _needed then
    insert into public.unlocks (user_id, key) values (_uid, 'best_industries')
    on conflict (user_id, key) do nothing;
  end if;
  select * into _unlock from public.unlocks where user_id = _uid and key = 'best_industries';

  if _unlock.id is not null then
    -- Per industry (compared case-insensitively): generated contacts, those
    -- already called (moved out of Unreached) and those that got a meeting.
    select coalesce(jsonb_agg(row_to_json(r) order by r.meetings::numeric / greatest(r.called, 1) desc, r.called desc), '[]'::jsonb)
    into _industries
    from (
      select
        min(c.generated_industry) as industry,
        count(*)::integer as contacts,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.from_table_id
          where m.contact_id = c.id and t.system_key = 'unreached'
        ))::integer as called,
        count(*) filter (where exists (
          select 1 from public.contact_table_moves m
          join public.contact_tables t on t.id = m.to_table_id
          where m.contact_id = c.id and t.system_key = 'meeting_scheduled'
        ))::integer as meetings
      from public.contacts c
      where c.user_id = _uid and c.generated_industry is not null
      group by lower(c.generated_industry)
      limit 50
    ) r;
  end if;

  return jsonb_build_object(
    'meetings', _meetings,
    'needed', _needed,
    'unlocked_at', _unlock.unlocked_at,
    'seen_at', _unlock.seen_at,
    'industries', _industries
  );
end;
$$;

revoke execute on function public.industry_insights() from public, anon;
grant execute on function public.industry_insights() to authenticated;
