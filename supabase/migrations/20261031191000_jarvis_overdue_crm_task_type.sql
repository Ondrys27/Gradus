-- =============================================================================
-- Fix (found in 17.3): the rule suggestion "overdueCrmTask" from 17.1 was
-- never allowed by jarvis_suggestions_type_check, so saving it failed and
-- /api/jarvis?view=suggestions answered 500 for anyone with an overdue sales
-- task. The check only widens; no row changes.
-- =============================================================================

alter table public.jarvis_suggestions drop constraint jarvis_suggestions_type_check;
alter table public.jarvis_suggestions add constraint jarvis_suggestions_type_check check (type in (
  'dealWon', 'followUps', 'stalledDeal', 'overdueTask', 'milestoneReady', 'overdueInvoice',
  'overdueCrmTask', 'taskCompleted', 'insight', 'pathReady', 'briefing', 'question'
));
