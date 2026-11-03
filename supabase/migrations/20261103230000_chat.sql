-- =============================================================================
-- Messages (19.4): a chat inside the company
--   * chat_channels: a space's conversations. `group` = one per worker group
--     (name and colour kept equal to the group by the database; a deleted
--     group leaves its channel archived, read only, history kept), `direct` =
--     two members, unique per pair (direct_key), made at the first message.
--   * chat_members: who is in a channel. worker_id null = the owner of the
--     space; `member` is the token used everywhere else (the owner's user id
--     or the worker's id). The owner is a member of every group channel. The
--     members of a group channel follow the group's members by trigger.
--     last_read_at (null = nothing read), muted and pinned_at are the
--     member's own and change only through the chat_* functions.
--   * chat_messages: body (≤ 4 000), attachments (JSON, files in the private
--     bucket chat-attachments, ≤ 10 MB each), a reply to another message of
--     the channel, edited_at, deleted_at. The sender is stamped by the
--     database from the session. Own messages are edited and deleted within
--     15 minutes, the owner deletes anybody's; a deleted message keeps no
--     text and no files. Messages are never removed.
--   * Only members read anything (RLS through chat_is_member, which also
--     drives Realtime); a worker counts only while active, so a removed
--     worker loses access at once and their messages stay with their name.
--     Nobody outside the space reads or writes. Jarvis never reads the chat.
--   * Files: uploaded by a member of the space under
--     <space>/<message>/<file> before the message is sent; readable while a
--     live message of a channel the reader is in lists them. A server-only
--     table counts when a file was last opened; a daily cron moves files not
--     opened for a year to the trash and removes files of deleted messages.
--   * E-mail about direct messages and @mentions: the server decides (the
--     member was away 10 minutes, at most one e-mail an hour) through
--     chat_email_claim(); user_settings.chat_email_notifications turns it off.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('group', 'direct')),
  group_id uuid,
  -- A group channel's name and tone (src/components/ui/tone.ts), copied from
  -- the group by the database so an archived channel keeps them.
  name text check (name is null or char_length(name) between 1 and 60),
  color text check (color is null or color in ('violet', 'teal', 'gold', 'green', 'pink', 'neutral')),
  -- "<member>:<member>" in sorted order, only for a direct channel.
  direct_key text,
  -- The owner silenced the group for everyone: no sound, badge or e-mail.
  muted_all boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, direct_key),
  foreign key (group_id, owner_id) references public.worker_groups (id, owner_id)
    on delete set null (group_id),
  constraint chat_channels_kind_shape check (
    (kind = 'group' and direct_key is null and name is not null)
    or (kind = 'direct' and direct_key is not null and group_id is null and name is null)
  )
);
create unique index chat_channels_group_idx on public.chat_channels (group_id) where group_id is not null;
create index chat_channels_owner_idx on public.chat_channels (owner_id);

create trigger set_updated_at before update on public.chat_channels
  for each row execute function public.set_updated_at();

create table public.chat_members (
  channel_id uuid not null,
  owner_id uuid not null,
  -- null = the owner of the space.
  worker_id uuid,
  member uuid generated always as (coalesce(worker_id, owner_id)) stored,
  last_read_at timestamptz,
  muted boolean not null default false,
  pinned_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (channel_id, member),
  foreign key (channel_id, owner_id) references public.chat_channels (id, owner_id) on delete cascade,
  foreign key (worker_id, owner_id) references public.workers (id, owner_id) on delete cascade
);
create index chat_members_member_idx on public.chat_members (member);
create index chat_members_owner_idx on public.chat_members (owner_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  owner_id uuid not null,
  sender_user_id uuid default auth.uid() references auth.users (id) on delete set null,
  sender_is_owner boolean not null default false,
  sender_worker_id uuid,
  -- The member who wrote it; null once a worker's record is gone.
  sender uuid generated always as (
    case when sender_is_owner then owner_id else sender_worker_id end
  ) stored,
  body text not null default '' check (char_length(body) <= 4000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  reply_to_id uuid references public.chat_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  foreign key (channel_id, owner_id) references public.chat_channels (id, owner_id) on delete cascade,
  foreign key (sender_worker_id, owner_id) references public.workers (id, owner_id)
    on delete set null (sender_worker_id),
  constraint chat_messages_sender check (not (sender_is_owner and sender_worker_id is not null)),
  constraint chat_messages_not_empty check (
    deleted_at is not null or char_length(btrim(body)) > 0 or jsonb_array_length(attachments) > 0
  ),
  constraint chat_messages_deleted_empty check (
    deleted_at is null or (body = '' and attachments = '[]'::jsonb)
  )
);
create index chat_messages_channel_created_idx on public.chat_messages (channel_id, created_at desc, id desc);
create index chat_messages_owner_idx on public.chat_messages (owner_id, created_at desc);
create index chat_messages_sender_worker_idx on public.chat_messages (sender_worker_id)
  where sender_worker_id is not null;
create index chat_messages_reply_idx on public.chat_messages (reply_to_id) where reply_to_id is not null;

-- When each file was last opened (server only), for the yearly trash.
create table public.chat_attachment_files (
  path text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  size bigint not null,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz,
  trashed_at timestamptz
);
create index chat_attachment_files_message_idx on public.chat_attachment_files (message_id);
create index chat_attachment_files_stale_idx on public.chat_attachment_files (coalesce(last_opened_at, created_at))
  where trashed_at is null;
alter table public.chat_attachment_files enable row level security;
revoke all on public.chat_attachment_files from anon, authenticated;

-- The last chat e-mail of each account (server only): at most one an hour.
create table public.chat_email_log (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_sent_at timestamptz not null default now()
);
alter table public.chat_email_log enable row level security;
revoke all on public.chat_email_log from anon, authenticated;

-- The member's own notification choices.
alter table public.user_settings
  add column chat_email_notifications boolean not null default true,
  add column chat_sound boolean not null default true;

-- -----------------------------------------------------------------------------
-- Who is who
-- -----------------------------------------------------------------------------

-- The signed-in account's member token in a space: the owner's id for the
-- owner, the worker's id for an active worker, else null. Internal.
create or replace function public.chat_member_token(_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or _owner is null then null
    when _owner = auth.uid() then _owner
    else (
      select w.id from public.workers w
      where w.owner_id = _owner and w.user_id = auth.uid() and w.status = 'active'
      order by w.created_at
      limit 1
    )
  end;
$$;
revoke execute on function public.chat_member_token(uuid) from public, anon;
grant execute on function public.chat_member_token(uuid) to authenticated;

-- Whether the signed-in account is a member of the channel right now.
create or replace function public.chat_is_member(_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select exists (
        select 1 from public.chat_members m
        where m.channel_id = c.id and m.member = public.chat_member_token(c.owner_id)
      )
      from public.chat_channels c
      where c.id = _channel
    ),
    false
  );
$$;
revoke execute on function public.chat_is_member(uuid) from public, anon;
grant execute on function public.chat_is_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.chat_channels enable row level security;
create policy "chat_channels_member_select" on public.chat_channels for select to authenticated
  using (public.chat_is_member(id));
revoke insert, update, delete on public.chat_channels from anon, authenticated;

alter table public.chat_members enable row level security;
create policy "chat_members_member_select" on public.chat_members for select to authenticated
  using (public.chat_is_member(channel_id));
revoke insert, update, delete on public.chat_members from anon, authenticated;

alter table public.chat_messages enable row level security;
create policy "chat_messages_member_select" on public.chat_messages for select to authenticated
  using (public.chat_is_member(channel_id));
create policy "chat_messages_member_insert" on public.chat_messages for insert to authenticated
  with check (public.chat_is_member(channel_id));
create policy "chat_messages_member_update" on public.chat_messages for update to authenticated
  using (public.chat_is_member(channel_id))
  with check (public.chat_is_member(channel_id));
-- Messages are never removed; deleting one empties it (chat_messages_guard).
revoke delete on public.chat_messages from anon, authenticated;
revoke all on public.chat_channels, public.chat_members, public.chat_messages from anon;

-- -----------------------------------------------------------------------------
-- Messages: what the client may write
-- -----------------------------------------------------------------------------

-- The files of a new message: at most 5, each under <space>/<message>/<file>,
-- with a name, a size up to 10 MB and a type the bucket takes.
create or replace function public.chat_attachments_valid(_items jsonb, _owner uuid, _message uuid)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  _item jsonb;
  _prefix text := _owner::text || '/' || _message::text || '/';
  _paths text[] := '{}';
begin
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) > 5 then
    return false;
  end if;
  for _item in select value from jsonb_array_elements(_items) loop
    if jsonb_typeof(_item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(_item) k
         where k not in ('path', 'name', 'size', 'mime', 'width', 'height')
       )
       or jsonb_typeof(_item -> 'path') is distinct from 'string'
       or jsonb_typeof(_item -> 'name') is distinct from 'string'
       or jsonb_typeof(_item -> 'size') is distinct from 'number'
       or jsonb_typeof(_item -> 'mime') is distinct from 'string'
    then
      return false;
    end if;
    if left(_item ->> 'path', length(_prefix)) <> _prefix
       or substr(_item ->> 'path', length(_prefix) + 1)
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (_item ->> 'path') = any (_paths)
       or char_length(_item ->> 'name') not between 1 and 200
       or (_item ->> 'size')::numeric not between 1 and 10485760
       or (_item ->> 'size')::numeric <> trunc((_item ->> 'size')::numeric)
       or (_item ->> 'mime') not in (
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.oasis.opendocument.text',
         'application/vnd.oasis.opendocument.spreadsheet',
         'application/vnd.oasis.opendocument.presentation',
         'application/zip',
         'text/plain',
         'text/csv'
       )
    then
      return false;
    end if;
    if (_item ? 'width' and (jsonb_typeof(_item -> 'width') <> 'number'
          or (_item ->> 'width')::numeric not between 1 and 20000))
       or (_item ? 'height' and (jsonb_typeof(_item -> 'height') <> 'number'
          or (_item ->> 'height')::numeric not between 1 and 20000))
    then
      return false;
    end if;
    _paths := _paths || (_item ->> 'path');
  end loop;
  return true;
end;
$$;
revoke execute on function public.chat_attachments_valid(jsonb, uuid, uuid) from public, anon;

-- Whether the other person of a direct conversation was removed from the company.
create or replace function public.chat_direct_peer_gone(_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_members o
    join public.chat_channels c on c.id = o.channel_id
    join public.workers w on w.id = o.worker_id and w.owner_id = c.owner_id
    where o.channel_id = _channel
      and public.chat_is_member(_channel)
      and o.member is distinct from public.chat_member_token(c.owner_id)
      and w.status = 'inactive'
  );
$$;
revoke execute on function public.chat_direct_peer_gone(uuid) from public, anon;
grant execute on function public.chat_direct_peer_gone(uuid) to authenticated;

-- A new message: the space, the sender and the time come from the database;
-- a change is the sender's text within 15 minutes, or deleting it (the sender
-- within 15 minutes, the owner of the space at any time). A deleted message
-- keeps no text and no files and changes no more. Runs as the caller, so it
-- sees only what the caller may see.
create or replace function public.chat_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _channel public.chat_channels;
  _me uuid;
  _mine boolean;
  _fresh boolean;
begin
  if tg_op = 'INSERT' then
    select * into _channel from public.chat_channels c where c.id = new.channel_id;
    if not found then
      raise exception 'chat_channel_not_found' using errcode = 'no_data_found';
    end if;
    if _channel.archived_at is not null then
      raise exception 'chat_channel_archived' using errcode = 'check_violation';
    end if;
    new.owner_id := _channel.owner_id;
    if public.is_client_request() then
      _me := public.chat_member_token(_channel.owner_id);
      if _me is null or not exists (
        select 1 from public.chat_members m where m.channel_id = _channel.id and m.member = _me
      ) then
        raise exception 'chat_not_member' using errcode = 'insufficient_privilege';
      end if;
      new.sender_user_id := auth.uid();
      new.sender_is_owner := _me = _channel.owner_id;
      new.sender_worker_id := case when _me = _channel.owner_id then null else _me end;
      new.created_at := now();
      new.edited_at := null;
      new.deleted_at := null;
      -- A removed worker reads nothing any more, so nobody writes to them.
      if _channel.kind = 'direct' and public.chat_direct_peer_gone(_channel.id) then
        raise exception 'chat_member_invalid' using errcode = 'check_violation';
      end if;
    end if;
    if new.deleted_at is null
       and char_length(btrim(new.body)) = 0 and jsonb_array_length(new.attachments) = 0 then
      raise exception 'chat_message_empty' using errcode = 'check_violation';
    end if;
    if not public.chat_attachments_valid(new.attachments, new.owner_id, new.id) then
      raise exception 'chat_attachments_invalid' using errcode = 'check_violation';
    end if;
    if new.reply_to_id is not null and not exists (
      select 1 from public.chat_messages r
      where r.id = new.reply_to_id and r.channel_id = new.channel_id
    ) then
      raise exception 'chat_reply_outside' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if not public.is_client_request() then
    return new;
  end if;
  if old.deleted_at is not null then
    raise exception 'chat_message_deleted' using errcode = 'check_violation';
  end if;
  if (new.id, new.channel_id, new.owner_id, new.sender_user_id, new.sender_is_owner,
      new.sender_worker_id, new.created_at, new.reply_to_id)
     is distinct from
     (old.id, old.channel_id, old.owner_id, old.sender_user_id, old.sender_is_owner,
      old.sender_worker_id, old.created_at, old.reply_to_id)
  then
    raise exception 'chat_message_fixed' using errcode = 'check_violation';
  end if;
  _me := public.chat_member_token(old.owner_id);
  _mine := _me is not null and _me is not distinct from old.sender;
  _fresh := now() - old.created_at <= interval '15 minutes';

  if new.deleted_at is not null then
    if not ((_mine and _fresh) or auth.uid() = old.owner_id) then
      raise exception 'chat_message_locked' using errcode = 'check_violation';
    end if;
    new.deleted_at := now();
    new.body := '';
    new.attachments := '[]'::jsonb;
    new.edited_at := old.edited_at;
    return new;
  end if;

  new.attachments := old.attachments;
  if new.body is distinct from old.body then
    if not (_mine and _fresh) then
      raise exception 'chat_message_locked' using errcode = 'check_violation';
    end if;
    if char_length(btrim(new.body)) = 0 and jsonb_array_length(old.attachments) = 0 then
      raise exception 'chat_message_empty' using errcode = 'check_violation';
    end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.chat_messages_guard() from public, anon;

create trigger chat_messages_guard
  before insert or update on public.chat_messages
  for each row execute function public.chat_messages_guard();
create trigger chat_messages_writable
  before insert or update on public.chat_messages
  for each row execute function public.enforce_workspace_writable('owner_id');
create trigger chat_channels_writable
  before insert on public.chat_channels
  for each row execute function public.enforce_workspace_writable('owner_id');

-- Every file of a new message is counted from when it was sent.
create or replace function public.chat_messages_track_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_attachment_files (path, owner_id, message_id, size)
  select a ->> 'path', new.owner_id, new.id, (a ->> 'size')::bigint
  from jsonb_array_elements(new.attachments) a
  on conflict (path) do nothing;
  return new;
end;
$$;
revoke execute on function public.chat_messages_track_files() from public, anon, authenticated;

create trigger chat_messages_track_files
  after insert on public.chat_messages
  for each row when (jsonb_array_length(new.attachments) > 0)
  execute function public.chat_messages_track_files();

-- -----------------------------------------------------------------------------
-- Group channels follow the groups
-- -----------------------------------------------------------------------------

create or replace function public.chat_groups_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _channel uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.chat_channels (owner_id, kind, group_id, name, color)
    values (new.owner_id, 'group', new.id, new.name, new.color)
    returning id into _channel;
    insert into public.chat_members (channel_id, owner_id, worker_id, last_read_at)
    values (_channel, new.owner_id, null, now());
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (new.name, new.color) is distinct from (old.name, old.color) then
      update public.chat_channels c set name = new.name, color = new.color
      where c.group_id = new.id;
    end if;
    return new;
  end if;
  -- DELETE: the conversation stays, read only, with everyone who was in it.
  update public.chat_channels c set archived_at = now() where c.group_id = old.id;
  return old;
end;
$$;
revoke execute on function public.chat_groups_sync() from public, anon, authenticated;

create trigger chat_groups_sync
  after insert or update of name, color on public.worker_groups
  for each row execute function public.chat_groups_sync();
create trigger chat_groups_archive
  before delete on public.worker_groups
  for each row execute function public.chat_groups_sync();

create or replace function public.chat_group_members_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.chat_members (channel_id, owner_id, worker_id, last_read_at)
    select c.id, c.owner_id, new.worker_id, now()
    from public.chat_channels c
    where c.group_id = new.group_id
    on conflict (channel_id, member) do nothing;
    return new;
  end if;
  -- Taken out of the group: out of its conversation. A group being deleted
  -- (no longer there) keeps its archived conversation's members.
  if exists (select 1 from public.worker_groups g where g.id = old.group_id) then
    delete from public.chat_members m
    using public.chat_channels c
    where c.group_id = old.group_id and m.channel_id = c.id and m.worker_id = old.worker_id;
  end if;
  return old;
end;
$$;
revoke execute on function public.chat_group_members_sync() from public, anon, authenticated;

create trigger chat_group_members_sync
  after insert or delete on public.worker_group_members
  for each row execute function public.chat_group_members_sync();

-- Today's groups get their conversations.
insert into public.chat_channels (owner_id, kind, group_id, name, color)
select g.owner_id, 'group', g.id, g.name, g.color from public.worker_groups g
on conflict do nothing;
insert into public.chat_members (channel_id, owner_id, worker_id, last_read_at)
select c.id, c.owner_id, null, now() from public.chat_channels c where c.kind = 'group'
on conflict do nothing;
insert into public.chat_members (channel_id, owner_id, worker_id, last_read_at)
select c.id, c.owner_id, gm.worker_id, now()
from public.worker_group_members gm
join public.chat_channels c on c.group_id = gm.group_id
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- What the app calls
-- -----------------------------------------------------------------------------

-- The people of the space one can talk to and whose names the messages show:
-- the owner and the workers. A worker does not see invited people outside
-- their own conversations.
create or replace function public.chat_people()
returns table (
  member uuid,
  is_owner boolean,
  name text,
  avatar_url text,
  job_title text,
  status public.worker_status,
  has_account boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select s.space, public.chat_member_token(s.space) as token
    from (select public.current_workspace_id() as space) s
  )
  select me.space, true, p.display_name, p.avatar_url, null::text, null::public.worker_status, true
  from me
  left join public.profiles p on p.id = me.space
  where me.token is not null
  union all
  select w.id, false, w.name, coalesce(w.avatar_url, p.avatar_url), w.job_title, w.status, w.user_id is not null
  from me
  join public.workers w on w.owner_id = me.space
  left join public.profiles p on p.id = w.user_id
  where me.token is not null
    and (
      me.token = me.space
      or w.status <> 'invited'
      or exists (
        select 1 from public.chat_members a
        join public.chat_members b on b.channel_id = a.channel_id
        where a.member = w.id and b.member = me.token
      )
    )
  limit 600;
$$;
revoke execute on function public.chat_people() from public, anon;
grant execute on function public.chat_people() to authenticated;

-- The conversations of the signed-in account in its space: what the list
-- shows, newest first (pinned on top), with the unread count (up to 100) and
-- whether an unread message mentions the account.
create or replace function public.chat_overview()
returns table (
  id uuid,
  kind text,
  name text,
  color text,
  group_id uuid,
  archived boolean,
  muted_all boolean,
  muted boolean,
  pinned_at timestamptz,
  last_read_at timestamptz,
  peer uuid,
  member_count integer,
  created_at timestamptz,
  last_id uuid,
  last_sender uuid,
  last_body text,
  last_attachments integer,
  last_deleted boolean,
  last_at timestamptz,
  unread integer,
  mentioned boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select s.space, public.chat_member_token(s.space) as token
    from (select public.current_workspace_id() as space) s
  )
  select
    c.id,
    c.kind,
    c.name,
    c.color,
    c.group_id,
    c.archived_at is not null,
    c.muted_all,
    m.muted,
    m.pinned_at,
    m.last_read_at,
    case when c.kind = 'direct' then (
      select o.member from public.chat_members o
      where o.channel_id = c.id and o.member <> me.token
      limit 1
    ) end,
    (select count(*) from public.chat_members o where o.channel_id = c.id)::integer,
    c.created_at,
    l.id,
    l.sender,
    left(l.body, 240),
    coalesce(jsonb_array_length(l.attachments), 0),
    l.deleted_at is not null,
    l.created_at,
    (
      select count(*) from (
        select 1 from public.chat_messages u
        where u.channel_id = c.id
          and u.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
          and u.deleted_at is null
          and u.sender is distinct from me.token
        limit 100
      ) x
    )::integer,
    exists (
      select 1 from public.chat_messages u
      where u.channel_id = c.id
        and u.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)
        and u.deleted_at is null
        and u.sender is distinct from me.token
        and strpos(u.body, '<@' || me.token::text || '>') > 0
    )
  from me
  join public.chat_members m on m.member = me.token and m.owner_id = me.space
  join public.chat_channels c on c.id = m.channel_id
  left join lateral (
    select x.id, x.sender, x.body, x.attachments, x.deleted_at, x.created_at
    from public.chat_messages x
    where x.channel_id = c.id
    order by x.created_at desc, x.id desc
    limit 1
  ) l on true
  where me.token is not null
  order by m.pinned_at desc nulls last, coalesce(l.created_at, c.created_at) desc
  limit 300;
$$;
revoke execute on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated;

-- The direct conversation with one person of the space, made when the first
-- message is sent. Only the owner writes to someone who has not joined yet
-- (the messages wait for them); nobody to a removed worker.
create or replace function public.chat_open_direct(_to uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _space uuid := public.current_workspace_id();
  _me uuid;
  _target public.workers;
  _key text;
  _id uuid;
begin
  _me := public.chat_member_token(_space);
  if _me is null then
    raise exception 'chat_not_member' using errcode = 'insufficient_privilege';
  end if;
  if _to is null or _to = _me then
    raise exception 'chat_member_invalid' using errcode = 'check_violation';
  end if;
  if _to <> _space then
    select * into _target from public.workers w where w.id = _to and w.owner_id = _space;
    if not found
       or _target.status = 'inactive'
       or (_target.status = 'invited' and _me <> _space) then
      raise exception 'chat_member_invalid' using errcode = 'check_violation';
    end if;
  end if;
  _key := least(_me::text, _to::text) || ':' || greatest(_me::text, _to::text);
  select c.id into _id from public.chat_channels c where c.owner_id = _space and c.direct_key = _key;
  if _id is not null then
    return _id;
  end if;
  insert into public.chat_channels (owner_id, kind, direct_key)
  values (_space, 'direct', _key)
  on conflict (owner_id, direct_key) do nothing
  returning id into _id;
  if _id is null then
    select c.id into _id from public.chat_channels c where c.owner_id = _space and c.direct_key = _key;
    return _id;
  end if;
  insert into public.chat_members (channel_id, owner_id, worker_id)
  values
    (_id, _space, case when _me = _space then null else _me end),
    (_id, _space, case when _to = _space then null else _to end);
  return _id;
end;
$$;
revoke execute on function public.chat_open_direct(uuid) from public, anon;
grant execute on function public.chat_open_direct(uuid) to authenticated;

-- Marks the channel read up to a moment (the newest message the reader saw),
-- never back and never in the future. Works in a read-only space too.
create or replace function public.chat_mark_read(_channel uuid, _until timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
  _at timestamptz := least(coalesce(_until, now()), now());
  _result timestamptz;
begin
  select c.owner_id into _owner from public.chat_channels c where c.id = _channel;
  update public.chat_members m
  set last_read_at = greatest(coalesce(m.last_read_at, '-infinity'::timestamptz), _at)
  where m.channel_id = _channel and m.member = public.chat_member_token(_owner)
  returning m.last_read_at into _result;
  if _result is null then
    raise exception 'chat_not_member' using errcode = 'insufficient_privilege';
  end if;
  return _result;
end;
$$;
revoke execute on function public.chat_mark_read(uuid, timestamptz) from public, anon;
grant execute on function public.chat_mark_read(uuid, timestamptz) to authenticated;

-- The member's own pin and mute of a conversation (null leaves one as it is).
create or replace function public.chat_set_member_flags(
  _channel uuid,
  _pinned boolean default null,
  _muted boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner uuid;
begin
  select c.owner_id into _owner from public.chat_channels c where c.id = _channel;
  update public.chat_members m
  set
    pinned_at = case
      when _pinned is null then m.pinned_at
      when _pinned then coalesce(m.pinned_at, now())
      else null
    end,
    muted = coalesce(_muted, m.muted)
  where m.channel_id = _channel and m.member = public.chat_member_token(_owner);
  if not found then
    raise exception 'chat_not_member' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function public.chat_set_member_flags(uuid, boolean, boolean) from public, anon;
grant execute on function public.chat_set_member_flags(uuid, boolean, boolean) to authenticated;

-- The owner silences a group conversation for everyone, or lets it speak again.
create or replace function public.chat_set_muted_all(_channel uuid, _muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_channels c set muted_all = coalesce(_muted, false)
  where c.id = _channel and c.kind = 'group' and c.owner_id = auth.uid();
  if not found then
    raise exception 'chat_owner_only' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function public.chat_set_muted_all(uuid, boolean) from public, anon;
grant execute on function public.chat_set_muted_all(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- E-mail about direct messages and mentions (server only)
-- -----------------------------------------------------------------------------

-- Takes the account's chat e-mail of this hour when it was away for
-- _idle_minutes (no heartbeat of the app) and none went out in the last hour.
create or replace function public.chat_email_claim(_user uuid, _idle_minutes integer default 10)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _claimed uuid;
begin
  if _user is null then
    return false;
  end if;
  if exists (
    select 1 from public.app_sessions s
    where s.user_id = _user
      and s.last_seen_at > now() - make_interval(mins => greatest(_idle_minutes, 0))
  ) then
    return false;
  end if;
  insert into public.chat_email_log as l (user_id, last_sent_at)
  values (_user, now())
  on conflict (user_id) do update set last_sent_at = now()
    where l.last_sent_at <= now() - interval '1 hour'
  returning l.user_id into _claimed;
  return _claimed is not null;
end;
$$;
revoke execute on function public.chat_email_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.chat_email_claim(uuid, integer) to service_role;

-- What waits for an account: unread direct messages (in conversations it has
-- not muted) and unread mentions, per conversation, in every space it is in.
-- Counts and names only, never the text.
create or replace function public.chat_email_digest(_user uuid)
returns table (
  channel_id uuid,
  owner_id uuid,
  kind text,
  name text,
  peer uuid,
  messages integer,
  mentions integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with tokens as (
    select _user as space, _user as token
    union all
    select w.owner_id, w.id from public.workers w where w.user_id = _user and w.status = 'active'
  ),
  mine as (
    select m.channel_id, m.owner_id, m.member, m.last_read_at, m.muted, c.kind, c.name, c.muted_all
    from tokens t
    join public.chat_members m on m.member = t.token and m.owner_id = t.space
    join public.chat_channels c on c.id = m.channel_id
  ),
  counted as (
    select
      mine.*,
      (
        select o.member from public.chat_members o
        where o.channel_id = mine.channel_id and o.member <> mine.member
        limit 1
      ) as peer,
      (
        select count(*) from public.chat_messages u
        where u.channel_id = mine.channel_id
          and u.created_at > coalesce(mine.last_read_at, '-infinity'::timestamptz)
          and u.deleted_at is null and u.sender is distinct from mine.member
      )::integer as unread,
      (
        select count(*) from public.chat_messages u
        where u.channel_id = mine.channel_id
          and u.created_at > coalesce(mine.last_read_at, '-infinity'::timestamptz)
          and u.deleted_at is null and u.sender is distinct from mine.member
          and strpos(u.body, '<@' || mine.member::text || '>') > 0
      )::integer as mentioned
    from mine
  )
  select
    counted.channel_id,
    counted.owner_id,
    counted.kind,
    counted.name,
    case when counted.kind = 'direct' then counted.peer end,
    case when counted.kind = 'direct' and not counted.muted then counted.unread else 0 end,
    counted.mentioned
  from counted
  where (counted.kind = 'direct' and not counted.muted and counted.unread > 0)
     or counted.mentioned > 0
  order by counted.mentioned desc, counted.unread desc
  limit 20;
$$;
revoke execute on function public.chat_email_digest(uuid) from public, anon, authenticated;
grant execute on function public.chat_email_digest(uuid) to service_role;

-- Names of members of one space for the e-mail (server only).
create or replace function public.chat_member_names(_owner uuid, _members uuid[])
returns table (member uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select _owner, p.display_name from public.profiles p
  where p.id = _owner and _owner = any (_members)
  union all
  select w.id, w.name from public.workers w
  where w.owner_id = _owner and w.id = any (_members);
$$;
revoke execute on function public.chat_member_names(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.chat_member_names(uuid, uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- Files: chat-attachments/<space>/<message>/<file>
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'text/plain',
  'text/csv'
])
on conflict (id) do nothing;

-- Uploading a file of a message not sent yet: a member of the space (the
-- owner or an active worker), never in a read-only space.
create or replace function public.chat_attachment_uploadable(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  _owner text := split_part(_name, '/', 1);
  _message text := split_part(_name, '/', 2);
begin
  if _owner !~ _uuid or _message !~ _uuid or split_part(_name, '/', 3) !~ _uuid
     or split_part(_name, '/', 4) <> '' then
    return false;
  end if;
  if public.chat_member_token(_owner::uuid) is null or public.workspace_read_only(_owner::uuid) then
    return false;
  end if;
  return not exists (select 1 from public.chat_messages m where m.id = _message::uuid);
end;
$$;
revoke execute on function public.chat_attachment_uploadable(text) from public, anon;
grant execute on function public.chat_attachment_uploadable(text) to authenticated;

-- Reading a file: a live message of a conversation the reader is in lists it.
create or replace function public.chat_attachment_readable(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  _owner text := split_part(_name, '/', 1);
  _message text := split_part(_name, '/', 2);
begin
  if _owner !~ _uuid or _message !~ _uuid then
    return false;
  end if;
  return exists (
    select 1 from public.chat_messages m
    where m.id = _message::uuid
      and m.owner_id = _owner::uuid
      and m.deleted_at is null
      and m.attachments @> jsonb_build_array(jsonb_build_object('path', _name))
      and public.chat_is_member(m.channel_id)
  );
end;
$$;
revoke execute on function public.chat_attachment_readable(text) from public, anon;
grant execute on function public.chat_attachment_readable(text) to authenticated;

create policy "chat_attachments_object_select" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.chat_attachment_readable(name));
create policy "chat_attachments_object_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and public.chat_attachment_uploadable(name));

-- A file was opened: counted at most once a day (server only).
create or replace function public.chat_attachment_opened(_path text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.chat_attachment_files f set last_opened_at = now()
  where f.path = _path
    and (f.last_opened_at is null or f.last_opened_at < now() - interval '1 day');
$$;
revoke execute on function public.chat_attachment_opened(text) from public, anon, authenticated;
grant execute on function public.chat_attachment_opened(text) to service_role;

-- What the daily cron does with files: `trash` = not opened for a year,
-- `remove` = of a deleted message. Server only.
create or replace function public.chat_attachments_due(_limit integer default 200)
returns table (path text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  (
    select f.path, 'remove' from public.chat_attachment_files f
    join public.chat_messages m on m.id = f.message_id
    where m.deleted_at is not null
    limit greatest(_limit, 0)
  )
  union all
  (
    select f.path, 'trash' from public.chat_attachment_files f
    join public.chat_messages m on m.id = f.message_id
    where m.deleted_at is null and f.trashed_at is null
      and coalesce(f.last_opened_at, f.created_at) < now() - interval '1 year'
    limit greatest(_limit, 0)
  );
$$;
revoke execute on function public.chat_attachments_due(integer) from public, anon, authenticated;
grant execute on function public.chat_attachments_due(integer) to service_role;

-- Records what the cron did: trashed files are marked, removed ones forgotten;
-- a restored file is live again.
create or replace function public.chat_attachments_mark(_paths text[], _action text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _count integer;
begin
  if _action = 'trash' then
    update public.chat_attachment_files f set trashed_at = now()
    where f.path = any (_paths) and f.trashed_at is null;
  elsif _action = 'restore' then
    update public.chat_attachment_files f set trashed_at = null, last_opened_at = now()
    where f.path = any (_paths);
  elsif _action = 'remove' then
    delete from public.chat_attachment_files f where f.path = any (_paths);
  else
    raise exception 'chat_attachment_action' using errcode = 'check_violation';
  end if;
  get diagnostics _count = row_count;
  return _count;
end;
$$;
revoke execute on function public.chat_attachments_mark(text[], text) from public, anon, authenticated;
grant execute on function public.chat_attachments_mark(text[], text) to service_role;

-- Files uploaded a day ago or more that no message lists (the message was
-- never sent). Server only; plpgsql because storage.objects is Supabase's.
create or replace function public.chat_orphan_uploads(_limit integer default 200)
returns table (path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'chat-attachments'
      and o.name !~ '^trash/'
      and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.chat_attachment_files f where f.path = o.name)
    limit greatest(_limit, 0);
end;
$$;
revoke execute on function public.chat_orphan_uploads(integer) from public, anon, authenticated;
grant execute on function public.chat_orphan_uploads(integer) to service_role;

-- Which trashed files a list of paths has (the conversation shows them as in the trash).
create or replace function public.chat_trashed_files(_paths text[])
returns table (path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.path from public.chat_attachment_files f
  where f.path = any (_paths[1:500]) and f.trashed_at is not null
    and public.chat_attachment_readable(f.path);
$$;
revoke execute on function public.chat_trashed_files(text[]) from public, anon;
grant execute on function public.chat_trashed_files(text[]) to authenticated;

-- A deleted account's files also leave the chat trash (trash/<space>/…).
create or replace function public.account_storage_objects(_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.name like _user::text || '/%'
     or (o.bucket_id = 'chat-attachments' and o.name like 'trash/' || _user::text || '/%')
  order by o.bucket_id, o.name;
$$;

-- -----------------------------------------------------------------------------
-- Realtime: members hear new messages, reads and conversations at once
-- (Supabase checks the policies above for every listener).
-- -----------------------------------------------------------------------------

do $$
declare
  _table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach _table in array array['chat_messages', 'chat_members', 'chat_channels'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = _table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', _table);
      end if;
    end loop;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics: the new events (mirrors src/lib/analytics/events.ts)
-- -----------------------------------------------------------------------------

insert into public.analytics_event_catalog (event, section, active) values
  ('chat_message_sent', 'messages', true),
  ('chat_message_edited', 'messages', true),
  ('chat_message_deleted', 'messages', true),
  ('chat_conversation_muted', 'messages', false),
  ('chat_conversation_exported', 'messages', false),
  ('chat_email_sent', 'messages', false)
on conflict (event) do nothing;
