-- =============================================================================
-- Global search (⌘K)
--   * unaccent + pg_trgm: "novak" finds "Novák", typos and parts of words match
--   * the app calls one function, global_search(), with the signed-in user's
--     client; it runs as that user (security invoker), so row level security
--     decides which rows come back
--   * GIN trigram indexes on the normalized text of every searched table
--   * recent searches and recently opened results live in user_settings (max 8)
--
-- Why two functions: under RLS Postgres never uses an index for a condition
-- whose operator is not LEAKPROOF (LIKE and the pg_trgm operators are not), so
-- the trigram indexes would sit unused and every search would scan all of the
-- user's rows. search_matches() therefore finds the matching ids and their rank
-- with the indexes, strictly limited to rows of auth.uid(); global_search()
-- then reads the rows themselves through RLS. Nothing but ids and ranks of the
-- caller's own rows ever leaves the definer function.
-- =============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Normalization. unaccent() is only STABLE (its dictionary could change), so it
-- is wrapped with the dictionary named explicitly; that makes the wrapper safe
-- to declare IMMUTABLE and to use in index expressions. The high cost tells the
-- planner that computing it for every row is worse than asking the index.
-- -----------------------------------------------------------------------------

create or replace function public.search_norm(_value text)
returns text
language sql
immutable
parallel safe
cost 1000
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(_value, '')));
$$;

/* The searchable text of a row: its parts joined by spaces, normalized. */
create or replace function public.search_doc(variadic _parts text[])
returns text
language sql
immutable
parallel safe
cost 1000
as $$
  select public.search_norm(array_to_string(_parts, ' '));
$$;

/*
 * How well a row answers the (normalized) query, higher first: the title is
 * the query, starts with it, has a word starting with it, the row contains it
 * anywhere, and last the fuzzy word similarity that tolerates typos.
 */
create or replace function public.search_rank(_q text, _title text, _doc text)
returns real
language sql
immutable
parallel safe
as $$
  select case
    when _q = '' then 0::real
    when public.search_norm(_title) = _q then 3::real
    when public.search_norm(_title) like _q || '%' then 2.5::real
    when public.search_norm(_title) like '% ' || _q || '%' then 2::real
    when _doc like '%' || _q || '%' then 1.5::real
    else extensions.word_similarity(_q, _doc)
  end;
$$;

-- -----------------------------------------------------------------------------
-- Trigram indexes on exactly the expressions search_matches() filters by
-- -----------------------------------------------------------------------------

create index contacts_search_idx on public.contacts
  using gin (public.search_doc(company_name, first_name, last_name, email) extensions.gin_trgm_ops);
create index contacts_phone_search_idx on public.contacts
  using gin (phone_normalized extensions.gin_trgm_ops) where phone_normalized is not null;
create index deals_search_idx on public.deals
  using gin (public.search_doc(title) extensions.gin_trgm_ops);
create index milestones_search_idx on public.milestones
  using gin (public.search_doc(title, description) extensions.gin_trgm_ops);
create index tasks_search_idx on public.tasks
  using gin (public.search_doc(title, description) extensions.gin_trgm_ops);
create index calendar_events_search_idx on public.calendar_events
  using gin (public.search_doc(title, description) extensions.gin_trgm_ops);
create index transactions_search_idx on public.transactions
  using gin (public.search_doc(description) extensions.gin_trgm_ops);
create index invoices_search_idx on public.invoices
  using gin (public.search_doc(number, customer_name) extensions.gin_trgm_ops);
create index workers_search_idx on public.workers
  using gin (public.search_doc(name, job_title) extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- search_matches(): ids and ranks of the caller's own rows of one kind
--   _q              normalized query (search_norm), at least 2 characters
--   _phones         LIKE patterns ('%digits%') for phone_normalized
--   _amount_digits  the query read as a whole amount, for deal values
-- -----------------------------------------------------------------------------

create or replace function public.search_matches(
  _kind text,
  _q text,
  _phones text[],
  _amount_digits text,
  _limit integer
)
returns table (id uuid, rank real)
language plpgsql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = '0.45'
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _text boolean := length(coalesce(_q, '')) >= 2;
  _lim integer := least(greatest(coalesce(_limit, 6), 1), 50);
begin
  if _uid is null then
    return;
  end if;
  _phones := coalesce(_phones, '{}');

  if _kind = 'contact' then
    return query
    with hits as (
      select c.id,
        public.search_rank(
          _q,
          coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)),
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        ) as r,
        c.updated_at
      from public.contacts c
      where _text
        and c.user_id = _uid
        and (
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        )
      union all
      select c.id, 2.2::real, c.updated_at
      from unnest(_phones) as p(pattern)
      join public.contacts c on c.phone_normalized like p.pattern
      where c.user_id = _uid
    )
    select h.id, max(h.r)::real
    from hits h
    group by h.id
    order by max(h.r) desc, max(h.updated_at) desc
    limit _lim;

  elsif _kind = 'deal' then
    return query
    with contact_ids as (
      select c.id
      from public.contacts c
      where _text
        and c.user_id = _uid
        and (
          public.search_doc(c.company_name, c.first_name, c.last_name, c.email) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(c.company_name, c.first_name, c.last_name, c.email)
        )
    ),
    hits as (
      select d.id, public.search_rank(_q, d.title, public.search_doc(d.title)) as r, d.updated_at
      from public.deals d
      where _text
        and d.user_id = _uid
        and (
          public.search_doc(d.title) like '%' || _q || '%'
          or _q operator(extensions.<%) public.search_doc(d.title)
        )
      union all
      select d.id, 1.4::real, d.updated_at
      from public.deals d
      where d.user_id = _uid and d.contact_id in (select ci.id from contact_ids ci)
      union all
      select d.id, (case when trunc(d.value)::text = _amount_digits then 2.4 else 1 end)::real, d.updated_at
      from public.deals d
      where _amount_digits is not null
        and d.user_id = _uid
        and d.value is not null
        and (
          trunc(d.value)::text = _amount_digits
          or (length(_amount_digits) >= 3 and trunc(d.value)::text like _amount_digits || '%')
        )
    )
    select h.id, max(h.r)::real
    from hits h
    group by h.id
    order by max(h.r) desc, max(h.updated_at) desc
    limit _lim;

  elsif not _text then
    return;

  elsif _kind = 'milestone' then
    return query
    select m.id, public.search_rank(_q, m.title, public.search_doc(m.title, m.description)) as r
    from public.milestones m
    where m.user_id = _uid
      and (
        public.search_doc(m.title, m.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(m.title, m.description)
      )
    order by r desc, m.updated_at desc
    limit _lim;

  elsif _kind = 'task' then
    return query
    select t.id, public.search_rank(_q, t.title, public.search_doc(t.title, t.description)) as r
    from public.tasks t
    where t.user_id = _uid
      and (
        public.search_doc(t.title, t.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(t.title, t.description)
      )
    order by r desc, t.updated_at desc
    limit _lim;

  elsif _kind = 'event' then
    return query
    select ev.id, public.search_rank(_q, ev.title, public.search_doc(ev.title, ev.description)) as r
    from public.calendar_events ev
    where ev.user_id = _uid
      and (
        public.search_doc(ev.title, ev.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(ev.title, ev.description)
      )
    order by r desc, ev.updated_at desc
    limit _lim;

  elsif _kind = 'transaction' then
    return query
    select tr.id, public.search_rank(_q, tr.description, public.search_doc(tr.description)) as r
    from public.transactions tr
    where tr.user_id = _uid
      and (
        public.search_doc(tr.description) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(tr.description)
      )
    order by r desc, tr.updated_at desc
    limit _lim;

  elsif _kind = 'invoice' then
    return query
    select i.id, public.search_rank(_q, i.number, public.search_doc(i.number, i.customer_name)) as r
    from public.invoices i
    where i.user_id = _uid
      and (
        public.search_doc(i.number, i.customer_name) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(i.number, i.customer_name)
      )
    order by r desc, i.updated_at desc
    limit _lim;

  elsif _kind = 'worker' then
    return query
    select w.id, public.search_rank(_q, w.name, public.search_doc(w.name, w.job_title)) as r
    from public.workers w
    where w.owner_id = _uid
      and (
        public.search_doc(w.name, w.job_title) like '%' || _q || '%'
        or _q operator(extensions.<%) public.search_doc(w.name, w.job_title)
      )
    order by r desc, w.updated_at desc
    limit _lim;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- global_search(): what the app calls
--   _query           what the user typed
--   _phone_patterns  digit sequences to find inside phone_normalized (the app
--                    derives them from the query, see contact-search.ts)
--   _amount          the query read as a number, to find deals by their value
--   _kinds           only these result kinds; null for all
--   _limit           rows per kind (1–50)
-- Every row is read here as the caller, through RLS, with its display context.
-- -----------------------------------------------------------------------------

create or replace function public.global_search(
  _query text,
  _phone_patterns text[] default '{}',
  _amount numeric default null,
  _kinds text[] default null,
  _limit integer default 6
)
returns table (kind text, id uuid, title text, rank real, data jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  _q text := public.search_norm(left(btrim(regexp_replace(coalesce(_query, ''), '\s+', ' ', 'g')), 100));
  _lim integer := least(greatest(coalesce(_limit, 6), 1), 50);
  _phones text[] := coalesce(
    (select array_agg('%' || p || '%') from unnest(coalesce(_phone_patterns, '{}')) p
     where p ~ '^[0-9]{3,15}$'),
    '{}'
  );
  _amount_digits text := trunc(abs(_amount))::text;
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  with
  contact_hits as (
    select
      c.id,
      coalesce(nullif(c.company_name, ''), concat_ws(' ', c.first_name, c.last_name)) as title,
      m.rank,
      jsonb_build_object(
        'company', c.company_name,
        'person', nullif(concat_ws(' ', c.first_name, c.last_name), ''),
        'email', c.email,
        'phone', c.phone,
        'table', t.name
      ) as data,
      c.updated_at
    from public.search_matches('contact', _q, _phones, _amount_digits, _lim) m
    join public.contacts c on c.id = m.id
    left join public.contact_table_entries e on e.contact_id = c.id
    left join public.contact_tables t on t.id = e.table_id
    where _kinds is null or 'contact' = any(_kinds)
  ),
  deal_hits as (
    select
      d.id,
      d.title,
      m.rank,
      jsonb_build_object(
        'stage', s.name,
        'stageWon', s.is_won,
        'stageLost', s.is_lost,
        'value', d.value,
        'currency', d.currency,
        'contact', coalesce(nullif(c.company_name, ''), nullif(concat_ws(' ', c.first_name, c.last_name), ''))
      ) as data,
      d.updated_at
    from public.search_matches('deal', _q, _phones, _amount_digits, _lim) m
    join public.deals d on d.id = m.id
    join public.pipeline_stages s on s.id = d.stage_id
    left join public.contacts c on c.id = d.contact_id
    where _kinds is null or 'deal' = any(_kinds)
  ),
  milestone_hits as (
    select
      mi.id,
      mi.title,
      m.rank,
      jsonb_build_object('status', mi.status, 'targetDate', mi.target_date, 'category', mi.category) as data,
      mi.updated_at
    from public.search_matches('milestone', _q, _phones, _amount_digits, _lim) m
    join public.milestones mi on mi.id = m.id
    where _kinds is null or 'milestone' = any(_kinds)
  ),
  task_hits as (
    select
      t.id,
      t.title,
      m.rank,
      jsonb_build_object('milestoneId', t.milestone_id, 'milestone', mi.title, 'status', t.status) as data,
      t.updated_at
    from public.search_matches('task', _q, _phones, _amount_digits, _lim) m
    join public.tasks t on t.id = m.id
    join public.milestones mi on mi.id = t.milestone_id
    where _kinds is null or 'task' = any(_kinds)
  ),
  event_hits as (
    select
      ev.id,
      ev.title,
      m.rank,
      jsonb_build_object('startsAt', ev.starts_at, 'allDay', ev.all_day, 'kind', ev.kind) as data,
      ev.updated_at
    from public.search_matches('event', _q, _phones, _amount_digits, _lim) m
    join public.calendar_events ev on ev.id = m.id
    where _kinds is null or 'event' = any(_kinds)
  ),
  transaction_hits as (
    select
      tr.id,
      tr.description as title,
      m.rank,
      jsonb_build_object(
        'type', tr.type,
        'amount', tr.amount,
        'currency', tr.currency,
        'occurredOn', tr.occurred_on,
        'category', tr.category
      ) as data,
      tr.updated_at
    from public.search_matches('transaction', _q, _phones, _amount_digits, _lim) m
    join public.transactions tr on tr.id = m.id
    where _kinds is null or 'transaction' = any(_kinds)
  ),
  invoice_hits as (
    select
      i.id,
      i.number as title,
      m.rank,
      jsonb_build_object(
        'customer', i.customer_name,
        'amount', i.amount,
        'currency', i.currency,
        'status', i.status,
        'issuedOn', i.issued_on
      ) as data,
      i.updated_at
    from public.search_matches('invoice', _q, _phones, _amount_digits, _lim) m
    join public.invoices i on i.id = m.id
    where _kinds is null or 'invoice' = any(_kinds)
  ),
  worker_hits as (
    select
      w.id,
      w.name as title,
      m.rank,
      jsonb_build_object('jobTitle', w.job_title, 'status', w.status) as data,
      w.updated_at
    from public.search_matches('worker', _q, _phones, _amount_digits, _lim) m
    join public.workers w on w.id = m.id
    where _kinds is null or 'worker' = any(_kinds)
  )
  (select 'contact', h.id, h.title, h.rank, h.data from contact_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'deal', h.id, h.title, h.rank, h.data from deal_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'milestone', h.id, h.title, h.rank, h.data from milestone_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'task', h.id, h.title, h.rank, h.data from task_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'event', h.id, h.title, h.rank, h.data from event_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'transaction', h.id, h.title, h.rank, h.data from transaction_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'invoice', h.id, h.title, h.rank, h.data from invoice_hits h
    order by h.rank desc, h.updated_at desc)
  union all
  (select 'worker', h.id, h.title, h.rank, h.data from worker_hits h
    order by h.rank desc, h.updated_at desc);
end;
$$;

-- global_search() normalizes the query as the caller, so it needs unaccent
-- (new functions get no public execute here, see security_hardening).
grant execute on function extensions.unaccent(regdictionary, text) to authenticated;

revoke execute on function
  public.search_norm(text),
  public.search_doc(text[]),
  public.search_rank(text, text, text),
  public.search_matches(text, text, text[], text, integer),
  public.global_search(text, text[], numeric, text[], integer)
  from public, anon;
grant execute on function
  public.search_norm(text),
  public.search_doc(text[]),
  public.search_rank(text, text, text),
  public.search_matches(text, text, text[], text, integer),
  public.global_search(text, text[], numeric, text[], integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Recent searches and recently opened results, written by the signed-in user
-- (the existing user_settings policies: own row only)
-- -----------------------------------------------------------------------------

alter table public.user_settings
  add column recent_searches text[] not null default '{}',
  add column recent_search_items jsonb not null default '[]',
  add constraint user_settings_recent_searches_check
    check (cardinality(recent_searches) <= 8 and length(array_to_string(recent_searches, '')) <= 800),
  add constraint user_settings_recent_search_items_check
    check (
      jsonb_typeof(recent_search_items) = 'array'
      and jsonb_array_length(recent_search_items) <= 8
      and length(recent_search_items::text) <= 8000
    );
