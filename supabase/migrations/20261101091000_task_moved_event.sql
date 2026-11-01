-- Analytics: moving a milestone task (17.5), mirrors src/lib/analytics/events.ts.
insert into public.analytics_event_catalog (event, section, active) values
  ('task_moved', 'milestones', true)
on conflict (event) do nothing;
