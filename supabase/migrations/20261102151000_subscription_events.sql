-- Analytics: Settings → Subscription (18.3), mirrors src/lib/analytics/events.ts.
insert into public.analytics_event_catalog (event, section, active) values
  ('subscription_change_requested', 'plan', false),
  ('subscription_cancelled', 'plan', false)
on conflict (event) do nothing;
