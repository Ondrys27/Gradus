-- =============================================================================
-- Phones in E.164
--   * the app now saves every phone as E.164 ("+420777123456"); this converts
--     the numbers saved before, on contacts and workers
--   * a number without a prefix is read in the contact's country, else the
--     owner's country from user_settings, else CZ
--   * a number that cannot be recognised stays exactly as it was; the count is
--     printed as a notice
--   * duplicates of generated contacts are matched on the whole number now,
--     not on its last nine digits
-- =============================================================================

-- Country calling codes (from libphonenumber-js metadata).
create or replace function public.phone_calling_code(_country text)
returns text
language sql
immutable
set search_path = ''
as $$
  select v.code from (values
    ('AC', '247'), ('AD', '376'), ('AE', '971'), ('AF', '93'), ('AG', '1'), ('AI', '1'), ('AL', '355'), ('AM', '374'),
    ('AO', '244'), ('AR', '54'), ('AS', '1'), ('AT', '43'), ('AU', '61'), ('AW', '297'), ('AX', '358'), ('AZ', '994'),
    ('BA', '387'), ('BB', '1'), ('BD', '880'), ('BE', '32'), ('BF', '226'), ('BG', '359'), ('BH', '973'), ('BI', '257'),
    ('BJ', '229'), ('BL', '590'), ('BM', '1'), ('BN', '673'), ('BO', '591'), ('BQ', '599'), ('BR', '55'), ('BS', '1'),
    ('BT', '975'), ('BW', '267'), ('BY', '375'), ('BZ', '501'), ('CA', '1'), ('CC', '61'), ('CD', '243'), ('CF', '236'),
    ('CG', '242'), ('CH', '41'), ('CI', '225'), ('CK', '682'), ('CL', '56'), ('CM', '237'), ('CN', '86'), ('CO', '57'),
    ('CR', '506'), ('CU', '53'), ('CV', '238'), ('CW', '599'), ('CX', '61'), ('CY', '357'), ('CZ', '420'), ('DE', '49'),
    ('DJ', '253'), ('DK', '45'), ('DM', '1'), ('DO', '1'), ('DZ', '213'), ('EC', '593'), ('EE', '372'), ('EG', '20'),
    ('EH', '212'), ('ER', '291'), ('ES', '34'), ('ET', '251'), ('FI', '358'), ('FJ', '679'), ('FK', '500'), ('FM', '691'),
    ('FO', '298'), ('FR', '33'), ('GA', '241'), ('GB', '44'), ('GD', '1'), ('GE', '995'), ('GF', '594'), ('GG', '44'),
    ('GH', '233'), ('GI', '350'), ('GL', '299'), ('GM', '220'), ('GN', '224'), ('GP', '590'), ('GQ', '240'), ('GR', '30'),
    ('GT', '502'), ('GU', '1'), ('GW', '245'), ('GY', '592'), ('HK', '852'), ('HN', '504'), ('HR', '385'), ('HT', '509'),
    ('HU', '36'), ('ID', '62'), ('IE', '353'), ('IL', '972'), ('IM', '44'), ('IN', '91'), ('IO', '246'), ('IQ', '964'),
    ('IR', '98'), ('IS', '354'), ('IT', '39'), ('JE', '44'), ('JM', '1'), ('JO', '962'), ('JP', '81'), ('KE', '254'),
    ('KG', '996'), ('KH', '855'), ('KI', '686'), ('KM', '269'), ('KN', '1'), ('KP', '850'), ('KR', '82'), ('KW', '965'),
    ('KY', '1'), ('KZ', '7'), ('LA', '856'), ('LB', '961'), ('LC', '1'), ('LI', '423'), ('LK', '94'), ('LR', '231'),
    ('LS', '266'), ('LT', '370'), ('LU', '352'), ('LV', '371'), ('LY', '218'), ('MA', '212'), ('MC', '377'), ('MD', '373'),
    ('ME', '382'), ('MF', '590'), ('MG', '261'), ('MH', '692'), ('MK', '389'), ('ML', '223'), ('MM', '95'), ('MN', '976'),
    ('MO', '853'), ('MP', '1'), ('MQ', '596'), ('MR', '222'), ('MS', '1'), ('MT', '356'), ('MU', '230'), ('MV', '960'),
    ('MW', '265'), ('MX', '52'), ('MY', '60'), ('MZ', '258'), ('NA', '264'), ('NC', '687'), ('NE', '227'), ('NF', '672'),
    ('NG', '234'), ('NI', '505'), ('NL', '31'), ('NO', '47'), ('NP', '977'), ('NR', '674'), ('NU', '683'), ('NZ', '64'),
    ('OM', '968'), ('PA', '507'), ('PE', '51'), ('PF', '689'), ('PG', '675'), ('PH', '63'), ('PK', '92'), ('PL', '48'),
    ('PM', '508'), ('PR', '1'), ('PS', '970'), ('PT', '351'), ('PW', '680'), ('PY', '595'), ('QA', '974'), ('RE', '262'),
    ('RO', '40'), ('RS', '381'), ('RU', '7'), ('RW', '250'), ('SA', '966'), ('SB', '677'), ('SC', '248'), ('SD', '249'),
    ('SE', '46'), ('SG', '65'), ('SH', '290'), ('SI', '386'), ('SJ', '47'), ('SK', '421'), ('SL', '232'), ('SM', '378'),
    ('SN', '221'), ('SO', '252'), ('SR', '597'), ('SS', '211'), ('ST', '239'), ('SV', '503'), ('SX', '1'), ('SY', '963'),
    ('SZ', '268'), ('TA', '290'), ('TC', '1'), ('TD', '235'), ('TG', '228'), ('TH', '66'), ('TJ', '992'), ('TK', '690'),
    ('TL', '670'), ('TM', '993'), ('TN', '216'), ('TO', '676'), ('TR', '90'), ('TT', '1'), ('TV', '688'), ('TW', '886'),
    ('TZ', '255'), ('UA', '380'), ('UG', '256'), ('US', '1'), ('UY', '598'), ('UZ', '998'), ('VA', '39'), ('VC', '1'),
    ('VE', '58'), ('VG', '1'), ('VI', '1'), ('VN', '84'), ('VU', '678'), ('WF', '681'), ('WS', '685'), ('XK', '383'),
    ('YE', '967'), ('YT', '262'), ('ZA', '27'), ('ZM', '260'), ('ZW', '263')
  ) as v(country, code)
  where v.country = upper(_country);
$$;

-- Best-effort E.164 for a stored phone, or null when it cannot be recognised.
-- Only punctuation used in phone numbers is accepted; letters (e.g. "ext.")
-- mean the text is left alone. A national number drops its trunk "0" (except
-- in Italy, San Marino and the Vatican, where it belongs to the number) and a
-- North American one its leading "1".
create or replace function public.phone_to_e164(_phone text, _country text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  _text text := btrim(coalesce(_phone, ''));
  _clean text;
  _digits text;
  _code text;
  _national text;
  _region text := upper(coalesce(nullif(btrim(_country), ''), 'CZ'));
begin
  if _text = '' or _text ~ '[^0-9+().[:space:]/-]' then
    return null;
  end if;
  _clean := regexp_replace(_text, '[^0-9+]', '', 'g');
  if _clean !~ '^\+?[0-9]+$' then
    return null;
  end if;

  if left(_clean, 1) = '+' then
    _digits := substr(_clean, 2);
  elsif left(_clean, 2) = '00' then
    _digits := substr(_clean, 3);
  else
    _code := public.phone_calling_code(_region);
    if _code is null then
      return null;
    end if;
    _national := _clean;
    if _region not in ('IT', 'SM', 'VA') then
      _national := regexp_replace(_national, '^0', '');
    end if;
    if _code = '1' and char_length(_national) = 11 and left(_national, 1) = '1' then
      _national := substr(_national, 2);
    end if;
    if char_length(_national) < 6 then
      return null;
    end if;
    _digits := _code || _national;
  end if;

  if char_length(_digits) not between 8 and 15 or left(_digits, 1) = '0' then
    return null;
  end if;
  return '+' || _digits;
end;
$$;

revoke execute on function public.phone_calling_code(text), public.phone_to_e164(text, text)
  from public, anon, authenticated;

do $$
declare
  _contacts integer;
  _workers integer;
begin
  update public.contacts c
  set phone = x.e164
  from (
    select c2.id, public.phone_to_e164(c2.phone, coalesce(c2.country_code, s.country_code)) as e164
    from public.contacts c2
    left join public.user_settings s on s.user_id = c2.user_id
    where c2.phone is not null
  ) x
  where x.id = c.id and x.e164 is not null and x.e164 <> c.phone;

  update public.workers w
  set phone = x.e164
  from (
    select w2.id, public.phone_to_e164(w2.phone, s.country_code) as e164
    from public.workers w2
    left join public.user_settings s on s.user_id = w2.owner_id
    where w2.phone is not null
  ) x
  where x.id = w.id and x.e164 is not null and x.e164 <> w.phone;

  select count(*)::integer into _contacts
  from public.contacts
  where btrim(coalesce(phone, '')) <> '' and phone !~ '^\+[1-9][0-9]{7,14}$';
  select count(*)::integer into _workers
  from public.workers
  where btrim(coalesce(phone, '')) <> '' and phone !~ '^\+[1-9][0-9]{7,14}$';

  raise notice 'Phones left unchanged (not recognised): % contacts, % workers', _contacts, _workers;
end;
$$;

-- Generated contacts: the route sends E.164, so a duplicate is the same whole
-- number. Otherwise unchanged from 20260925170000_industry_insights.sql.
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
              and c.phone_normalized = _phone)
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
