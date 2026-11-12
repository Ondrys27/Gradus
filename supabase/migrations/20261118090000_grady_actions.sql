-- 26.2 Grady works in the app: every change Grady makes (or proposes) on the
-- user's word in the chat is one row here. Instant changes are done at once
-- and can be undone for 24 hours; confirm changes wait for the user's
-- Confirm / Cancel (30 minutes). The server writes the rows (admin client,
-- user from the session); the owner of a row reads it, nobody else.
--
-- The change itself never goes through this table: the tools write with the
-- user's own client, so row level security, the guards and read-only mode
-- apply exactly as when the user works by hand. `result` keeps the ids of the
-- records and their state before the change, for Undo.

create table public.grady_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.jarvis_conversations (id) on delete cascade,
  -- The assistant message the action belongs to; written before the message exists, so no key.
  message_id uuid,
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,63}$'),
  risk text not null check (risk in ('instant', 'confirm')),
  status text not null default 'pending'
    check (status in ('pending', 'done', 'undone', 'rejected', 'expired', 'failed')),
  input jsonb not null default '{}' check (jsonb_typeof(input) = 'object'),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error text check (error is null or error ~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$'),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  undone_at timestamptz,
  check (pg_column_size(input) <= 65536),
  check (result is null or pg_column_size(result) <= 262144)
);

create index grady_actions_user_created_idx on public.grady_actions (user_id, created_at desc);
create index grady_actions_message_idx on public.grady_actions (message_id) where message_id is not null;
create index grady_actions_conversation_idx on public.grady_actions (conversation_id);

alter table public.grady_actions enable row level security;

-- The owner reads their own rows; there is no client policy for writing.
create policy grady_actions_select_own on public.grady_actions
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.grady_actions from anon, authenticated;
grant select on public.grady_actions to authenticated;
grant all on public.grady_actions to service_role;

-- A read-only space takes no new action from a signed-in user, also through a definer function.
create trigger grady_actions_writable
  before insert or update or delete on public.grady_actions
  for each row execute function public.enforce_workspace_writable('space_id');

-- The events of the tools (src/lib/analytics/events.ts).
insert into public.analytics_event_catalog (event, section, active) values
  ('grady_action_done', 'jarvis', true),
  ('grady_action_confirmed', 'jarvis', true),
  ('grady_action_rejected', 'jarvis', false),
  ('grady_action_undone', 'jarvis', true),
  ('grady_action_failed', 'jarvis', false)
on conflict (event) do nothing;
