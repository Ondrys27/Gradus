// @vitest-environment node
//
// Calendar sharing inside a company (step 30.3) in the real migrations on
// PGlite: the owner sees the busy times of their people by default (and can
// switch it off), nobody else sees anything until a share or an answered
// request; busy gives only times, read everything but private events, write
// creates and changes events in the person's calendar (never their private
// ones, never their sharing); a private event stays hidden from the owner of
// the space even through the table; a declined request waits seven days;
// meetings invite people into their Gradus calendar; leaving ends it all.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  _parts := string_to_array(name, '/');
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`;

type Row = Record<string, unknown>;

let db: PGlite;
let owner: string;
let alice: string;
let bob: string;
let carol: string;
let aliceWorker: string;
let team: string;

const FROM = "2026-12-01T00:00:00Z";
const TO = "2026-12-08T00:00:00Z";

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string, space: string = uid) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [
    JSON.stringify({ "x-gradus-space": space }),
  ]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
  );
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await asUser(uid, owner);
  try {
    return await run();
  } finally {
    await asServer();
  }
}
async function attempt(uid: string, sql: string, params?: unknown[]): Promise<string> {
  return as(uid, () =>
    db.query(sql, params as never).then(
      () => "ok",
      (error: Error) => error.message,
    ),
  );
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function hire(account: string, name: string) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, 'active') returning id`,
    [owner, account, name],
  );
  // Calendar: see and add own events.
  await db.query(
    `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
     values ($1, $2, 'calendar', 'view', true), ($1, $2, 'calendar', 'create', true),
            ($1, $2, 'calendar', 'update', true)
     on conflict (worker_id, section, action) do update set allowed = true`,
    [owner, id],
  );
  return id;
}
/** An event of `uid` in the company (their own client). */
async function addEvent(
  uid: string,
  title: string,
  at: string,
  options: { private?: boolean } = {},
) {
  return as(uid, async () => {
    const { id } = await one<{ id: string }>(
      `insert into calendar_events (user_id, title, kind, starts_at, ends_at, private)
       values ($1, $2, 'meeting', $3::timestamptz, $3::timestamptz + interval '1 hour', $4) returning id`,
      [owner, title, at, options.private ?? false],
    );
    return id;
  });
}
type Shared = {
  id: string;
  person_id: string;
  level: string;
  busy_only: boolean;
  title: string | null;
  location: string | null;
  created_by_name: string | null;
  can_edit: boolean;
  invite_status: string | null;
};
const sharedOf = (uid: string) =>
  as(uid, () =>
    rows<Shared>(`select * from calendar_shared_events($1, $2, $3)`, [owner, FROM, TO]),
  );
const busyOf = (uid: string, people: string[]) =>
  as(uid, () =>
    rows<{ person_id: string; known: boolean; starts_at: string | null }>(
      `select * from calendar_people_busy($1, $2::uuid[], $3, $4)`,
      [owner, people, FROM, TO],
    ),
  );
async function request(from: string, to: string, level: string, message: string | null = null) {
  return as(from, async () => {
    const { id } = await one<{ id: string }>(
      `select calendar_share_request_create($1, $2, $3, $4) as id`,
      [owner, to, level, message],
    );
    return id;
  });
}
const respond = (uid: string, id: string, approve: boolean, level: string | null = null) =>
  as(uid, () =>
    one<{ r: string }>(`select calendar_share_request_respond($1, $2, $3) as r`, [
      id,
      approve,
      level,
    ]),
  );

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser();
  owner = await createAuthUser();
  alice = await createAuthUser();
  bob = await createAuthUser();
  carol = await createAuthUser();
  aliceWorker = await hire(alice, "Alice");
  await hire(bob, "Bob");
  const carolWorker = await hire(carol, "Carol");
  await asServer();
  team = (
    await one<{ id: string }>(
      `insert into worker_groups (owner_id, name) values ($1, 'Obchod') returning id`,
      [owner],
    )
  ).id;
  await db.query(
    `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3)`,
    [team, carolWorker, owner],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("calendar sharing: defaults", () => {
  it("lets the owner see the busy times of their people, and nobody else anything", async () => {
    const event = await addEvent(alice, "Schůzka s klientem", "2026-12-02T09:00:00Z");
    const ownerView = (await sharedOf(owner)).filter((row) => row.person_id === alice);
    // The owner reads the company's events through the table anyway; the
    // share adds Alice's calendar (and the same event comes busy-only here).
    expect(ownerView.find((row) => row.id === event)).toMatchObject({
      level: "busy",
      busy_only: true,
      title: null,
    });
    expect((await sharedOf(bob)).filter((row) => row.person_id === alice)).toEqual([]);
    const busy = await busyOf(bob, [alice]);
    expect(busy).toEqual([expect.objectContaining({ person_id: alice, known: false })]);
    expect((await busyOf(owner, [alice])).filter((row) => row.known)).toHaveLength(1);
  });

  it("stops the owner's default when they switch it off", async () => {
    await asServer();
    await db.query(`update user_settings set calendar_owner_sees_busy = false where user_id = $1`, [
      owner,
    ]);
    expect((await sharedOf(owner)).filter((row) => row.person_id === alice)).toEqual([]);
    expect(await busyOf(owner, [alice])).toEqual([expect.objectContaining({ known: false })]);
    await asServer();
    await db.query(`update user_settings set calendar_owner_sees_busy = true where user_id = $1`, [
      owner,
    ]);
  });
});

describe("calendar sharing: private events", () => {
  it("keeps a private event from the owner of the space, even through the table", async () => {
    const secret = await addEvent(alice, "Lékař", "2026-12-03T10:00:00Z", { private: true });
    expect(
      await as(owner, () => rows(`select id from calendar_events where id = $1`, [secret])),
    ).toEqual([]);
    expect(
      await as(owner, () =>
        db
          .query(`update calendar_events set title = 'x' where id = $1`, [secret])
          .then((r) => r.affectedRows),
      ),
    ).toBe(0);
    expect(
      await as(owner, () =>
        db.query(`delete from calendar_events where id = $1`, [secret]).then((r) => r.affectedRows),
      ),
    ).toBe(0);
    // Only as busy time, without its title.
    const row = (await sharedOf(owner)).find((item) => item.id === secret);
    expect(row).toMatchObject({ busy_only: true, title: null, location: null });
    // Alice herself still has it.
    expect(
      await as(alice, () => rows(`select title from calendar_events where id = $1`, [secret])),
    ).toEqual([{ title: "Lékař" }]);
  });

  it("lets only the event's person turn private on or off", async () => {
    const event = await addEvent(alice, "Porada", "2026-12-04T08:00:00Z");
    await as(owner, () =>
      db.query(`update calendar_events set private = true where id = $1`, [event]),
    );
    expect(await one(`select private from calendar_events where id = $1`, [event])).toEqual({
      private: false,
    });
    // The client never names whose calendar it is.
    await as(alice, () =>
      db.query(`update calendar_events set calendar_owner_id = $2 where id = $1`, [event, bob]),
    );
    expect(
      await one(`select calendar_owner_id from calendar_events where id = $1`, [event]),
    ).toEqual({
      calendar_owner_id: alice,
    });
  });
});

describe("calendar sharing: requests", () => {
  it("asks, allows busy, then allows writing; private stays hidden", async () => {
    const meeting = await addEvent(alice, "Demo pro Nováka", "2026-12-02T13:00:00Z");
    const secret = await addEvent(alice, "Soukromé", "2026-12-02T15:00:00Z", { private: true });
    const first = await request(bob, alice, "busy", "Plánuju porady");
    expect(
      await one(
        `select kind, actor_id, share_level from account_notifications where calendar_request_id = $1`,
        [first],
      ),
    ).toEqual({ kind: "calendar_share_requested", actor_id: bob, share_level: "busy" });
    // Bob sees the request as his, Alice as waiting for her; Carol not at all.
    expect(
      await as(carol, () => rows(`select id from calendar_share_requests where id = $1`, [first])),
    ).toEqual([]);
    // Alice finds it waiting (in any company), with Bob's name and the message.
    expect(
      await as(alice, () =>
        rows(
          `select incoming, name, level, message from calendar_share_requests_list($1) where id = $2`,
          [alice, first],
        ),
      ),
    ).toEqual([{ incoming: true, name: "Bob", level: "busy", message: "Plánuju porady" }]);
    expect(await as(alice, () => rows(`select id from calendar_requests_waiting($1)`, [alice]))).toEqual([
      { id: first },
    ]);
    expect(await as(bob, () => rows(`select id from calendar_requests_waiting($1)`, [alice]))).toEqual([]);
    expect(await respond(alice, first, true)).toEqual({ r: "approved" });
    expect(
      await one(
        `select kind from account_notifications where calendar_request_id = $1 and user_id = $2`,
        [first, bob],
      ),
    ).toEqual({ kind: "calendar_share_approved" });

    let seen = (await sharedOf(bob)).filter((row) => row.person_id === alice);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((row) => row.busy_only && row.title === null)).toBe(true);
    // Busy: nothing to write.
    expect(
      await attempt(
        bob,
        `select calendar_shared_event_save($1, $2, null, 'Porada', 'meeting', '2026-12-05T09:00Z', '2026-12-05T10:00Z', false)`,
        [owner, alice],
      ),
    ).toMatch(/calendar_write_denied/);

    // Asking again at write while busy is granted is a new request.
    const second = await request(bob, alice, "write");
    expect(await respond(alice, second, true)).toEqual({ r: "approved" });
    seen = (await sharedOf(bob)).filter((row) => row.person_id === alice);
    expect(seen.find((row) => row.id === meeting)).toMatchObject({
      busy_only: false,
      title: "Demo pro Nováka",
    });
    expect(seen.find((row) => row.id === secret)).toMatchObject({
      busy_only: true,
      title: null,
      can_edit: false,
    });

    const created = await as(
      bob,
      async () =>
        (
          await one<{ id: string }>(
            `select calendar_shared_event_save($1, $2, null, 'Porada týmu', 'meeting', '2026-12-05T09:00Z', '2026-12-05T10:00Z', false) as id`,
            [owner, alice],
          )
        ).id,
    );
    await asServer();
    expect(
      await one(`select user_id, actor_id, calendar_owner_id from calendar_events where id = $1`, [
        created,
      ]),
    ).toEqual({ user_id: owner, actor_id: bob, calendar_owner_id: alice });
    // Alice sees it as hers (made by Bob) and may change it.
    expect(
      await as(alice, () => rows(`select id from calendar_events where id = $1`, [created])),
    ).toHaveLength(1);
    // In Alice's calendar it says who made it; the owner sees only the time.
    expect((await sharedOf(bob)).find((row) => row.id === created)?.created_by_name).toBe("Bob");
    expect((await sharedOf(owner)).find((row) => row.id === created)).toMatchObject({
      busy_only: true,
      created_by_name: null,
    });
    // Bob changes it through the share, never Alice's private one.
    expect(
      await attempt(
        bob,
        `select calendar_shared_event_save($1, $2, $3, 'Porada týmu 2', 'meeting', '2026-12-05T09:00Z', '2026-12-05T11:00Z', false)`,
        [owner, alice, meeting],
      ),
    ).toBe("ok");
    expect(
      await attempt(
        bob,
        `select calendar_shared_event_save($1, $2, $3, 'x', 'meeting', '2026-12-05T09:00Z', '2026-12-05T11:00Z', false)`,
        [owner, alice, secret],
      ),
    ).toMatch(/calendar_write_denied/);
    expect(await attempt(bob, `select calendar_shared_event_delete($1)`, [secret])).toMatch(
      /calendar_write_denied/,
    );
    // The private event never reaches Bob through the table either.
    expect(
      await as(bob, () => rows(`select id from calendar_events where id = $1`, [secret])),
    ).toEqual([]);
    // Nor may he change Alice's sharing.
    const share = await one<{ id: string }>(
      `select id from calendar_shares where user_id = $1 and target_user_id = $2`,
      [alice, bob],
    );
    expect(await as(bob, () => one(`select calendar_share_remove($1) as r`, [share.id]))).toEqual({
      r: false,
    });
    expect(
      await attempt(bob, `update calendar_shares set level = 'write' where id = $1`, [share.id]),
    ).toMatch(/permission denied/);
    expect(await attempt(bob, `select calendar_shared_event_delete($1)`, [created])).toBe("ok");
  });

  it("waits seven days after a decline", async () => {
    const id = await request(carol, alice, "read");
    expect(await respond(alice, id, false)).toEqual({ r: "declined" });
    expect(
      await attempt(carol, `select calendar_share_request_create($1, $2, 'busy', null)`, [
        owner,
        alice,
      ]),
    ).toMatch(/calendar_request_too_soon/);
    await asServer();
    await db.query(
      `update calendar_share_requests set responded_at = now() - interval '8 days' where id = $1`,
      [id],
    );
    expect(
      await attempt(carol, `select calendar_share_request_create($1, $2, 'busy', null)`, [
        owner,
        alice,
      ]),
    ).toBe("ok");
  });

  it("refuses requests outside the company and to oneself", async () => {
    const stranger = await createAuthUser();
    expect(
      await attempt(bob, `select calendar_share_request_create($1, $2, 'busy', null)`, [
        owner,
        stranger,
      ]),
    ).toMatch(/calendar_request_target/);
    expect(
      await attempt(bob, `select calendar_share_request_create($1, $2, 'busy', null)`, [
        owner,
        bob,
      ]),
    ).toMatch(/calendar_request_target/);
  });
});

describe("calendar sharing: shares", () => {
  it("shares with a group at read, only the chosen calendars", async () => {
    const event = await addEvent(bob, "Prezentace", "2026-12-06T09:00:00Z");
    await as(bob, () =>
      db.query(`select calendar_share_set($1, 'group', $2, 'read', array['gradus'])`, [
        owner,
        team,
      ]),
    );
    const carolSees = (await sharedOf(carol)).find((row) => row.id === event);
    expect(carolSees).toMatchObject({ level: "read", title: "Prezentace" });
    expect(
      await one(
        `select count(*)::int as n from account_notifications where user_id = $1 and kind = 'calendar_shared'`,
        [carol],
      ),
    ).toEqual({ n: 1 });
    // A calendar that is not the person's own is refused.
    expect(
      await attempt(bob, `select calendar_share_set($1, 'space', null, 'busy', array[$2])`, [
        owner,
        crypto.randomUUID(),
      ]),
    ).toMatch(/calendar_share_sources/);
    const people = await as(carol, () =>
      rows<{ user_id: string; level: string; can_write: boolean }>(
        `select user_id, level, can_write from calendar_visible_people($1)`,
        [owner],
      ),
    );
    expect(people.find((p) => p.user_id === bob)).toMatchObject({
      level: "read",
      can_write: false,
    });
  });

  it("makes everything from a private calendar private", async () => {
    await asServer();
    await db.query(
      `update app_settings set value = jsonb_set(value, '{mode}', '"everyone"') where key = 'calendar_sync'`,
    );
    const { id: connection } = await one<{ id: string }>(
      `insert into calendar_connections (user_id, provider, secret_cipher) values ($1, 'google', 'v1') returning id`,
      [alice],
    );
    const { id: calendar } = await one<{ id: string }>(
      `insert into calendar_connection_calendars (connection_id, external_id, name, read)
       values ($1, 'personal', 'Osobní', true) returning id`,
      [connection],
    );
    await db.query(`select calendar_sync_apply($1, $2::jsonb)`, [
      calendar,
      JSON.stringify([
        {
          external_id: "g1",
          title: "Zubař",
          starts_at: "2026-12-04T07:00:00Z",
          ends_at: "2026-12-04T08:00:00Z",
        },
      ]),
    ]);
    const { id: external } = await one<{ id: string }>(
      `select event_id as id from calendar_external_links where calendar_id = $1`,
      [calendar],
    );
    // Shared with Bob at read, the calendar included.
    await as(alice, () =>
      db.query(`select calendar_share_set($1, 'member', $2, 'write', array['gradus', $3])`, [
        owner,
        bob,
        calendar,
      ]),
    );
    expect((await sharedOf(bob)).find((row) => row.id === external)).toMatchObject({
      busy_only: false,
      title: "Zubař",
    });
    expect(
      await as(alice, () => one(`select calendar_set_private_default($1, true) as r`, [calendar])),
    ).toEqual({ r: true });
    expect((await sharedOf(bob)).find((row) => row.id === external)).toMatchObject({
      busy_only: true,
      title: null,
    });
    // Someone else's calendar is not theirs to change.
    expect(
      await as(bob, () => one(`select calendar_set_private_default($1, false) as r`, [calendar])),
    ).toEqual({ r: false });
  });
});

describe("calendar sharing: meetings with people", () => {
  it("invites people into their Gradus calendar", async () => {
    const id = await as(
      owner,
      async () =>
        (
          await one<{ id: string }>(
            `select calendar_meeting_create($1, 'Týdenní porada', '2026-12-07T09:00Z', '2026-12-07T10:00Z', $2::uuid[]) as id`,
            [owner, [carol]],
          )
        ).id,
    );
    const invite = (await sharedOf(carol)).find((row) => row.id === id);
    expect(invite).toMatchObject({
      title: "Týdenní porada",
      invite_status: "invited",
      busy_only: false,
    });
    expect(
      await as(carol, () => one(`select calendar_invite_respond($1, true) as r`, [id])),
    ).toEqual({ r: true });
    expect((await sharedOf(carol)).find((row) => row.id === id)?.invite_status).toBe("accepted");
    // It makes Carol busy for whoever sees her calendar.
    expect((await busyOf(owner, [carol])).some((row) => row.starts_at !== null)).toBe(true);
    // People outside the company are refused.
    const stranger = await createAuthUser();
    expect(
      await attempt(
        owner,
        `select calendar_meeting_create($1, 'X', '2026-12-07T09:00Z', '2026-12-07T10:00Z', $2::uuid[])`,
        [owner, [stranger]],
      ),
    ).toMatch(/calendar_meeting_invalid/);
  });
});

describe("calendar sharing: leaving", () => {
  it("ends what someone sees and what others see of them", async () => {
    expect((await sharedOf(bob)).some((row) => row.person_id === alice)).toBe(true);
    await asServer();
    await db.query(`update workers set status = 'inactive' where id = $1`, [aliceWorker]);
    expect((await sharedOf(bob)).some((row) => row.person_id === alice)).toBe(false);
    expect(
      await as(alice, () =>
        rows(`select * from calendar_shared_events($1, $2, $3)`, [owner, FROM, TO]),
      ),
    ).toEqual([]);
  });
});
