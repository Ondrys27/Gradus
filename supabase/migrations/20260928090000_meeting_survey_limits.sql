-- =============================================================================
-- Meeting surveys
--   * the answers are a small JSON object; the app writes a few dozen short
--     values, so anything bigger than this is not a survey
-- =============================================================================

alter table public.meeting_surveys
  add constraint meeting_surveys_answers_shape
  check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 16000);
