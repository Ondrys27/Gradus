-- =============================================================================
-- The trash's policy on sales tasks (step 28.8), corrected: a task without a
-- deal and a contact is refused by its own check (crm_tasks_target), not by
-- the trash's policy, so the error says what is wrong.
-- Replaces one policy of 20261202090000_mcp_server.sql; no data changes.
-- =============================================================================

drop policy if exists "crm_tasks_not_trashed" on public.crm_tasks;
create policy "crm_tasks_not_trashed" on public.crm_tasks
  as restrictive for select to authenticated
  using (
    (deal_id is null and contact_id is null)
    or (deal_id is not null and not public.deal_trashed(deal_id))
    or (contact_id is not null and not public.contact_trashed(contact_id))
  );
