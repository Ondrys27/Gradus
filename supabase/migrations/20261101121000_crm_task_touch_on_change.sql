-- =============================================================================
-- A task moves its deal's last activity when it is made, ticked off or back,
-- or tied to the deal; not when the form saves it unchanged in those columns
-- (the form always sends deal_id, so "update of deal_id" alone would count
-- every edit of the title or the due moment).
-- =============================================================================

drop trigger deals_touch_activity on public.crm_tasks;

create trigger deals_touch_activity
  after insert on public.crm_tasks
  for each row when (new.deal_id is not null)
  execute function public.deals_touch_activity();

create trigger deals_touch_activity_change
  after update of status, deal_id on public.crm_tasks
  for each row when (
    new.deal_id is not null
    and (new.status is distinct from old.status or new.deal_id is distinct from old.deal_id)
  )
  execute function public.deals_touch_activity();
