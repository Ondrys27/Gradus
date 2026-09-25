-- The cold-calling list shows the website next to the phone.
create or replace view public.contact_list
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
  ) as last_contact_at,
  c.website
from public.contacts c
left join public.contact_table_entries e
  on e.contact_id = c.id and e.user_id = c.user_id;
