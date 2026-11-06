-- 20.2 Mind map import and export in milestones: the two new events in the
-- catalog that mirrors src/lib/analytics/events.ts. Additive only; recording
-- does not depend on it, the metrics and the administration do.
insert into public.analytics_event_catalog (event, section, active) values
  ('mindmap_imported', 'milestones', true),
  ('mindmap_exported', 'milestones', false)
on conflict (event) do nothing;
