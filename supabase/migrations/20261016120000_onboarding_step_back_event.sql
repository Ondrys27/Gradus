-- Going back in the first-login wizard (its Back button or the browser's) is
-- its own event, so a step finished again is not counted as a new completion.
insert into public.analytics_event_catalog (event, section, active) values
  ('onboarding_step_back', 'onboarding', false);
