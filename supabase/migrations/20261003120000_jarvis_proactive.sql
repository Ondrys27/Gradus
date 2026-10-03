-- =============================================================================
-- Jarvis: guided tour and proactive assistant (step 9.7)
--   * jarvis_suggestions gets kind (briefing | suggestion | question), payload,
--     shown_at, answered_at and snoozed_until. Everything is still written by
--     /api/jarvis only; the client keeps stamping just seen_at / dismissed_at
--     (jarvis_suggestions_guard compares the whole row, so the new columns are
--     covered without a change)
--   * user_settings: the proactive switch, how often, and quiet hours
--   * profiles.tour_completed_at: the guided tour was finished or skipped;
--     existing accounts count as done (they can start it from Settings → Help)
--   * jarvis_briefing_candidates(): users whose morning brief is due now
--     (6–10 a.m. in their zone, unlocked, not written yet today), server only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Suggestions: three kinds of proactive content
-- -----------------------------------------------------------------------------

alter table public.jarvis_suggestions
  add column kind text not null default 'suggestion'
    check (kind in ('briefing', 'suggestion', 'question')),
  add column payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  add column shown_at timestamptz,
  add column answered_at timestamptz,
  add column snoozed_until timestamptz;

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady',
  'taskCompleted', 'insight', 'pathReady', 'briefing', 'question'
));
-- A briefing is always of type briefing, a question of type question, and back.
alter table public.jarvis_suggestions add constraint jarvis_suggestions_kind_type_check check (
  (kind = 'briefing') = (type = 'briefing') and (kind = 'question') = (type = 'question')
);

-- The last proactive appearance (the 4-hour rule) and this week's questions.
create index jarvis_suggestions_user_shown_idx
  on public.jarvis_suggestions (user_id, shown_at desc) where shown_at is not null;
create index jarvis_suggestions_user_kind_created_idx
  on public.jarvis_suggestions (user_id, kind, created_at desc);

comment on column public.jarvis_suggestions.kind is
  'briefing (morning brief), suggestion (what the watch or the rules noticed) or question (Jarvis asks to advise better).';
comment on column public.jarvis_suggestions.payload is
  'Kind-specific data written by the server: proposed tasks, the question and its answer, the briefing date.';
comment on column public.jarvis_suggestions.shown_at is
  'When Jarvis last brought it up on his own; the newest one keeps the next appearance 4+ hours away.';
comment on column public.jarvis_suggestions.snoozed_until is
  '"Later": not before this instant (the start of the next day in the user''s zone).';

-- -----------------------------------------------------------------------------
-- Settings: proactive switch, frequency, quiet hours (whole hours, user's zone)
-- -----------------------------------------------------------------------------

alter table public.user_settings
  add column jarvis_proactive boolean not null default true,
  add column jarvis_frequency text not null default 'sometimes'
    check (jarvis_frequency in ('often', 'sometimes', 'briefing_only')),
  add column jarvis_quiet_from smallint check (jarvis_quiet_from between 0 and 23),
  add column jarvis_quiet_to smallint check (jarvis_quiet_to between 0 and 23),
  add constraint user_settings_jarvis_quiet_check check (
    (jarvis_quiet_from is null and jarvis_quiet_to is null)
    or (jarvis_quiet_from is not null and jarvis_quiet_to is not null
        and jarvis_quiet_from <> jarvis_quiet_to)
  );

-- -----------------------------------------------------------------------------
-- Guided tour
-- -----------------------------------------------------------------------------

alter table public.profiles add column tour_completed_at timestamptz;

update public.profiles p
set tour_completed_at = now()
where p.tour_completed_at is null
  and (p.onboarding_completed_at is not null
       or exists (select 1 from public.workers w where w.user_id = p.id));

-- -----------------------------------------------------------------------------
-- Morning brief candidates (server only)
-- -----------------------------------------------------------------------------

-- Users whose brief is due: between 6 and 11 a.m. in their zone (a missed run
-- is caught up within the morning), proactive Jarvis on, onboarding done, the
-- brief unlocked (level 5 in game mode, always in tool mode), no brief yet
-- today and some activity in the last week.
create or replace function public.jarvis_briefing_candidates(_now timestamptz, _limit integer)
returns table (user_id uuid)
language sql
stable
set search_path = ''
as $$
  with zones as materialized (
    select z.name from pg_catalog.pg_timezone_names z
  ),
  -- Materialized: the zone is checked before `at time zone` can fail on it.
  enabled as materialized (
    select s.user_id, s.timezone
    from public.user_settings s
    join public.profiles p on p.id = s.user_id
    where s.jarvis_proactive
      and p.onboarding_completed_at is not null
      and s.timezone in (select name from zones)
      and (
        p.mode = 'tool'
        or exists (
          select 1 from public.unlocks u
          where u.user_id = s.user_id and u.key = 'jarvis_morning_brief'
        )
      )
  ),
  local as materialized (
    select e.user_id, (_now at time zone e.timezone) as local_now from enabled e
  )
  select l.user_id
  from local l
  where extract(hour from l.local_now) between 6 and 10
    and not exists (
      select 1 from public.jarvis_suggestions j
      where j.user_id = l.user_id
        and j.dedupe_key = 'briefing:' || to_char(l.local_now, 'YYYY-MM-DD')
    )
    and (
      exists (select 1 from public.deals d where d.user_id = l.user_id and d.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.tasks t where t.user_id = l.user_id and t.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.milestones m where m.user_id = l.user_id and m.updated_at >= _now - interval '7 days')
      or exists (select 1 from public.contact_table_moves c where c.user_id = l.user_id and c.created_at >= _now - interval '7 days')
      or exists (select 1 from public.calendar_events c where c.user_id = l.user_id and c.updated_at >= _now - interval '7 days')
    )
  order by l.user_id
  limit greatest(_limit, 0);
$$;
revoke execute on function public.jarvis_briefing_candidates(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.jarvis_briefing_candidates(timestamptz, integer) to service_role;
