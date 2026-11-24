-- =============================================================================
-- Restoring from the trash with the person's own client (step 28.8)
--   * trash_items.records (the rows as they were) becomes readable for the
--     person who deleted them: restoring inserts them again through row
--     level security, exactly as Grady's Undo does.
--   * trash_mark_restored(): marks such an item restored (their own, not yet
--     restored); it changes no data, so marking alone restores nothing.
-- Additive: a column grant and a new function.
-- =============================================================================

grant select (records) on public.trash_items to authenticated;

create or replace function public.trash_mark_restored(_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.trash_items
  set restored_at = now()
  where id = _id and user_id = auth.uid() and restored_at is null and records is not null;
  return found;
end;
$$;
revoke execute on function public.trash_mark_restored(uuid) from public, anon;
grant execute on function public.trash_mark_restored(uuid) to authenticated;
