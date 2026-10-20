-- =============================================================================
-- Plan catalog history and deleted accounts (15.5)
--
-- created_by and published_by are `on delete set null`, but the history guard
-- refused that update, so an account that had saved or published a version
-- could not be deleted. A version may now lose its author (the column
-- becomes null) and nothing else changes; everything else stays as before.
-- =============================================================================

create or replace function public.plan_catalog_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
    return old;
  end if;
  -- The author's account was deleted: only the author columns become null.
  if (new.created_by is distinct from old.created_by or new.published_by is distinct from old.published_by)
     and (new.created_by is not distinct from old.created_by or new.created_by is null)
     and (new.published_by is not distinct from old.published_by or new.published_by is null)
     and new.id = old.id and new.created_at = old.created_at and new.status = old.status
     and new.payload = old.payload and new.published_at is not distinct from old.published_at then
    return new;
  end if;
  if new.id <> old.id or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  if old.status = 'draft' then
    if new.status = 'archived' then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  elsif old.status = 'published' then
    if new.status <> 'archived' or new.payload <> old.payload
       or new.published_at is distinct from old.published_at
       or new.published_by is distinct from old.published_by then
      raise exception 'plan_catalog_history' using errcode = '42501';
    end if;
  else
    raise exception 'plan_catalog_history' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.plan_catalog_versions_guard() from public, anon, authenticated;
