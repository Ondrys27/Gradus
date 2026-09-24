-- =============================================================================
-- Pipeline: reason for a lost deal, the last stage cannot be removed,
-- and removing a stage moves its deals in one transaction.
-- =============================================================================

alter table public.deals
  add column lost_reason text check (char_length(lost_reason) <= 500);

-- A lost reason belongs to the lost stage only; it goes when the deal leaves it.
create or replace function public.deals_clear_lost_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lost_at is null then
    new.lost_reason := null;
  end if;
  return new;
end;
$$;
-- Runs after deals_before_stage_change (triggers fire alphabetically), which sets lost_at.
create trigger deals_lost_reason_follows_stage
  before insert or update on public.deals
  for each row execute function public.deals_clear_lost_reason();

-- Every user keeps at least one stage. The service role and cascades from
-- account deletion are not client requests and pass.
create or replace function public.pipeline_stages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and not exists (
       select 1 from public.pipeline_stages
       where user_id = old.user_id and id <> old.id
     ) then
    raise exception 'last_stage' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger pipeline_stages_guard
  before delete on public.pipeline_stages
  for each row execute function public.pipeline_stages_guard();

-- Removes a stage; its deals go to _move_to (required when it has any). The move
-- runs through the deal triggers, so entered_stage_at, won_at and the Clients
-- table are handled exactly as for a drag.
create or replace function public.remove_stage(_stage_id uuid, _move_to uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _offset integer;
begin
  if not exists (select 1 from public.pipeline_stages where id = _stage_id and user_id = _uid) then
    raise exception 'stage_not_found' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.deals where stage_id = _stage_id and user_id = _uid) then
    if _move_to is null or _move_to = _stage_id then
      raise exception 'target_stage_required' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.pipeline_stages where id = _move_to and user_id = _uid) then
      raise exception 'stage_not_found' using errcode = 'no_data_found';
    end if;
    select coalesce(max(position) + 1, 0) into _offset
    from public.deals where stage_id = _move_to and user_id = _uid;
    update public.deals
      set stage_id = _move_to, position = position + _offset
      where stage_id = _stage_id and user_id = _uid;
  end if;

  delete from public.pipeline_stages where id = _stage_id and user_id = _uid;
end;
$$;

revoke execute on function public.remove_stage(uuid, uuid), public.pipeline_stages_guard(),
  public.deals_clear_lost_reason() from public, anon;
