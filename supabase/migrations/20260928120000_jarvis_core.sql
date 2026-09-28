-- =============================================================================
-- Jarvis core
--   * ai_usage keeps the price of every model call next to its tokens, written
--     by /api/jarvis in the same request (server only, no client policies)
--   * the monthly call count uses the existing index on (user_id, created_at)
-- =============================================================================

alter table public.ai_usage
  add column cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0);

-- Messages are written by the server; the client reads its own and may delete them.
-- (insert/update policies were dropped in 20260923220000_server_owned_columns.sql)
comment on table public.jarvis_messages is
  'Jarvis chat history. Written only by /api/jarvis through the admin client; the client reads and deletes its own.';
comment on table public.ai_usage is
  'Every model call with its tokens and cost. Written only by /api/jarvis through the admin client; no client access.';
