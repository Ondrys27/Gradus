-- =============================================================================
-- Game interface (step 9.4)
--   * user_settings.theme: one of six colour themes. In game mode a theme other
--     than the default must be unlocked (level reward); in tool mode and for a
--     worker every theme is open. A trigger checks it, so the client cannot
--     pick a locked theme by writing the column directly
--   * the five theme unlocks are renamed to the six themes of the design
--     system (Gradus is the default and needs no unlock): Midnight 3, Forest 7,
--     Sunset 12, Steel 18, Light 25. Unlocks already granted move with them
--   * profiles.seen_level: the highest level the user has looked at in the
--     level window; the top bar pill pulses while the level is higher. Not the
--     level itself (that is computed from XP), only an acknowledgement
--   * jarvis_suggestions gets the type 'pathReady': Jarvis points to the
--     milestones a path just created
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Themes
-- -----------------------------------------------------------------------------

insert into public.unlock_definitions (key, kind, name, description, icon, position) values
  ('theme_midnight', 'theme',
   '{"en": "Midnight theme", "cs": "Téma Půlnoc"}',
   '{"en": "Deep blue with a silver shine.", "cs": "Hluboká modrá se stříbrným leskem."}',
   'palette', 20),
  ('theme_forest', 'theme',
   '{"en": "Forest theme", "cs": "Téma Les"}',
   '{"en": "Calm green with a gold accent.", "cs": "Klidná zelená se zlatým akcentem."}',
   'palette', 21),
  ('theme_steel', 'theme',
   '{"en": "Steel theme", "cs": "Téma Ocel"}',
   '{"en": "Cool grey with turquoise.", "cs": "Chladná šedá s tyrkysovou."}',
   'palette', 23),
  ('theme_light', 'theme',
   '{"en": "Light theme", "cs": "Téma Světlé"}',
   '{"en": "A light background with dark text.", "cs": "Světlé pozadí a tmavý text."}',
   'palette', 24);

update public.unlock_definitions
set name = '{"en": "Sunset theme", "cs": "Téma Západ"}',
    description = '{"en": "Warm orange and pink evening light.", "cs": "Teplá oranžová a růžová večerního světla."}',
    position = 22
where key = 'theme_sunset';

-- Granted unlocks and level rewards follow the rename, level by level.
with renames(old_key, new_key) as (
  values
    ('theme_aurora', 'theme_midnight'),
    ('theme_ocean', 'theme_forest'),
    ('theme_emerald', 'theme_steel'),
    ('theme_gold', 'theme_light')
)
update public.unlocks u
set key = r.new_key
from renames r
where u.key = r.old_key
  and not exists (select 1 from public.unlocks x where x.user_id = u.user_id and x.key = r.new_key);

delete from public.unlocks
where key in ('theme_aurora', 'theme_ocean', 'theme_emerald', 'theme_gold');

delete from public.level_rewards
where unlock_key in ('theme_aurora', 'theme_ocean', 'theme_sunset', 'theme_emerald', 'theme_gold');

insert into public.level_rewards (level, unlock_key) values
  (3, 'theme_midnight'),
  (7, 'theme_forest'),
  (12, 'theme_sunset'),
  (18, 'theme_steel'),
  (25, 'theme_light');

delete from public.unlock_definitions
where key in ('theme_aurora', 'theme_ocean', 'theme_emerald', 'theme_gold');

alter table public.user_settings
  add column theme text not null default 'gradus'
    check (theme in ('gradus', 'midnight', 'forest', 'sunset', 'steel', 'light'));

-- Whether a theme is open to the signed-in user: the default always, every
-- theme in tool mode and for a worker, otherwise only an unlocked one
-- (granted or by level). Reads only the caller's own rows.
create or replace function public.theme_available(_theme text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _theme = 'gradus'
    or public.current_workspace_id() is distinct from auth.uid()
    or coalesce((select p.mode from public.profiles p where p.id = auth.uid()), 'game') = 'tool'
    or exists (
      select 1 from public.unlocks u where u.user_id = auth.uid() and u.key = 'theme_' || _theme
    )
    or exists (
      select 1 from public.level_rewards r
      where r.unlock_key = 'theme_' || _theme
        and r.level <= public.game_level_for_xp(
          (select coalesce(sum(e.xp), 0) from public.xp_events e where e.user_id = auth.uid())::bigint
        )
    );
$$;

-- Runs as the caller, so is_client_request() sees the real role.
create or replace function public.user_settings_theme_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_request()
     and (tg_op = 'INSERT' or new.theme is distinct from old.theme)
     and not public.theme_available(new.theme) then
    raise exception 'theme_locked' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger user_settings_theme_guard
  before insert or update of theme on public.user_settings
  for each row execute function public.user_settings_theme_guard();

-- -----------------------------------------------------------------------------
-- The level the user has seen in the level window
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column seen_level integer not null default 1 check (seen_level between 1 and 30);

-- Existing accounts have seen their current level; only a new one pulses.
update public.profiles p
set seen_level = public.game_level_for_xp(
  (select coalesce(sum(e.xp), 0) from public.xp_events e where e.user_id = p.id)::bigint
);

-- -----------------------------------------------------------------------------
-- Jarvis: a path is ready
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady',
  'taskCompleted', 'insight', 'pathReady'
));

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke execute on function public.user_settings_theme_guard() from public, anon, authenticated;
revoke execute on function public.theme_available(text) from public, anon;
grant execute on function public.theme_available(text) to authenticated;
